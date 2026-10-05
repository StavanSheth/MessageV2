import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any
from playwright.async_api import async_playwright, BrowserContext, Page, Playwright
from backend.config.settings import settings, SCREENSHOTS_DIR

def get_chrome_executable() -> str:
    possible_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for p in possible_paths:
        if os.path.exists(p):
            return p
    return "chrome"

def check_cdp_endpoint() -> Optional[str]:
    import socket
    import httpx
    try:
        with socket.create_connection(("127.0.0.1", 9222), timeout=0.08):
            pass
    except Exception:
        return None

    for host in ["http://127.0.0.1:9222", "http://localhost:9222"]:
        try:
            r = httpx.get(f"{host}/json/version", timeout=0.4)
            if r.status_code == 200:
                return host
        except Exception:
            pass
    return None

class BrowserWorker:
    def __init__(self, user_data_dir: Optional[str] = None):
        self.user_data_dir = user_data_dir or settings.USER_DATA_DIR
        self.playwright: Optional[Playwright] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.is_running = False
        self._lock = asyncio.Lock()

    async def start(self) -> Page:
        async with self._lock:
            if self.is_running and self.page and not self.page.is_closed():
                return self.page

            Path(self.user_data_dir).mkdir(parents=True, exist_ok=True)
            # Remove any stale Chromium lock files
            for lock_name in ["SingletonLock", "Lockfile", "lockfile"]:
                f = Path(self.user_data_dir) / lock_name
                if f.exists():
                    try:
                        f.unlink()
                    except Exception:
                        pass

            self.playwright = await async_playwright().start()

            # Launch directly via Playwright native OS pipeline (--remote-debugging-pipe)
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--start-maximized",
                "--no-sandbox"
            ]
            try:
                self.context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=self.user_data_dir,
                    channel="chrome",
                    headless=False,
                    slow_mo=settings.BROWSER_SLOW_MO,
                    args=launch_args,
                    no_viewport=True
                )
            except Exception as e:
                print(f"[BrowserWorker] Launching native chrome failed ({e}), falling back to bundled chromium")
                self.context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=self.user_data_dir,
                    headless=False,
                    slow_mo=settings.BROWSER_SLOW_MO,
                    args=launch_args,
                    no_viewport=True
                )

            # Get or create page (protect localhost dashboard tabs)
            instagram_page = None
            blank_page = None
            for p in self.context.pages:
                if "instagram.com" in p.url:
                    instagram_page = p
                    break
                elif "localhost" in p.url or "127.0.0.1" in p.url:
                    continue
                elif p.url in ["about:blank", "chrome://newtab/"]:
                    blank_page = p

            if instagram_page:
                self.page = instagram_page
            elif blank_page:
                self.page = blank_page
                try:
                    await self.page.goto("https://www.instagram.com", wait_until="domcontentloaded", timeout=settings.BROWSER_TIMEOUT)
                except Exception:
                    pass
            else:
                self.page = await self.context.new_page()
                try:
                    await self.page.goto("https://www.instagram.com", wait_until="domcontentloaded", timeout=settings.BROWSER_TIMEOUT)
                except Exception:
                    pass


            try:
                await self.page.bring_to_front()
            except Exception:
                pass

            self.is_running = True
            return self.page


    async def stop(self) -> None:
        async with self._lock:
            try:
                if getattr(self, "_is_cdp", False):
                    if getattr(self, "browser", None):
                        await self.browser.close()
                        self.browser = None
                    self._is_cdp = False
                    self.context = None
                else:
                    if self.context:
                        await self.context.close()
                        self.context = None
                if self.playwright:
                    await self.playwright.stop()
                    self.playwright = None
            except Exception:
                pass
            finally:
                self.page = None
                self.is_running = False

    async def health(self) -> Dict[str, Any]:
        if not self.is_running or not self.page or self.page.is_closed():
            return {"status": "DISCONNECTED", "url": None}
        try:
            url = self.page.url
            try:
                title = await asyncio.wait_for(self.page.title(), timeout=1.0)
            except Exception:
                title = None
            return {"status": "CONNECTED", "url": url, "title": title}
        except Exception as e:
            return {"status": "ERROR", "error": str(e)}

    async def open_url(self, url: str) -> None:
        if not self.page or self.page.is_closed():
            await self.start()
        await self.page.goto(url, wait_until="domcontentloaded", timeout=settings.BROWSER_TIMEOUT)
        await asyncio.sleep(1)

    async def screenshot(self, stage: str = "general") -> Optional[str]:
        if not settings.SCREENSHOT_ENABLED or not self.page or self.page.is_closed():
            return None
        try:
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            filename = f"{timestamp}_{stage}.png"
            filepath = SCREENSHOTS_DIR / filename
            await self.page.screenshot(path=str(filepath), full_page=False)
            return f"/screenshots/{filename}"
        except Exception:
            return None

    async def current_state(self) -> Dict[str, Any]:
        h = await self.health()
        return {
            "browser_connected": h["status"] == "CONNECTED",
            "url": h.get("url"),
            "is_running": self.is_running
        }

    async def get_active_instagram_page(self, prefer_target_url: Optional[str] = None) -> Optional[Page]:
        """
        Dynamically finds the active/frontmost Instagram tab in Chrome,
        resolving mismatches when multiple Instagram tabs are open.
        """
        if not self.context or not self.context.pages:
            return None

        # 1. If actively working on a target URL, prefer the page matching that target
        if prefer_target_url:
            clean_target = prefer_target_url.split("?")[0].rstrip("/").lower()
            for p in self.context.pages:
                if not p.is_closed():
                    clean_p = p.url.split("?")[0].rstrip("/").lower()
                    if clean_target and clean_target in clean_p:
                        return p

        # 2. Query Chrome DevTools Protocol /json (targets are ordered MRU: active/focused tab first)
        cdp_host = check_cdp_endpoint()
        if cdp_host:
            try:
                import httpx
                async with httpx.AsyncClient(timeout=0.5) as client:
                    r = await client.get(f"{cdp_host}/json")
                    if r.status_code == 200:
                        targets = r.json()
                        ig_targets = [
                            t for t in targets
                            if t.get("type") == "page" and "instagram.com" in t.get("url", "").lower()
                        ]
                        if ig_targets:
                            active_url = ig_targets[0].get("url")
                            clean_active = active_url.split("?")[0].rstrip("/").lower()
                            for p in self.context.pages:
                                if not p.is_closed():
                                    clean_p = p.url.split("?")[0].rstrip("/").lower()
                                    if clean_active == clean_p or clean_active in p.url.lower():
                                        return p
            except Exception:
                pass

        # 3. Fallback: current self.page if alive and on Instagram
        if self.page and not self.page.is_closed() and "instagram.com" in self.page.url:
            return self.page

        # 4. Fallback: any open Instagram page in context
        for p in self.context.pages:
            if not p.is_closed() and "instagram.com" in p.url:
                return p

        return self.page

    async def capture_live_screenshot(self, target_url: Optional[str] = None) -> Optional[bytes]:
        if not self.context or not self.page or self.page.is_closed():
            cdp_url = check_cdp_endpoint()
            if cdp_url:
                try:
                    await self.start()
                except Exception:
                    pass

        # Synchronize with the currently active or target Instagram tab
        active_page = await self.get_active_instagram_page(prefer_target_url=target_url)
        if active_page and not active_page.is_closed():
            self.page = active_page

        if not self.page or self.page.is_closed():
            return None
        try:
            return await self.page.screenshot(type="jpeg", quality=75)
        except Exception:
            return None

