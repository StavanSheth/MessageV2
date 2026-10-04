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
    import httpx
    for host in ["http://localhost:9222", "http://127.0.0.1:9222", "http://[::1]:9222"]:
        try:
            r = httpx.get(f"{host}/json/version", timeout=0.6)
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

            # On Windows, launch Chrome via Windows Shell so it renders on the active interactive desktop
            if os.name == "nt":
                import subprocess
                cdp_url = check_cdp_endpoint()

                if not cdp_url:
                    chrome_bin = get_chrome_executable()
                    cmd = f'cmd.exe /c start "" "{chrome_bin}" --remote-debugging-port=9222 --profile-directory="Profile 4" --restore-last-session https://www.instagram.com'
                    subprocess.Popen(cmd, shell=True)
                    for _ in range(15):
                        await asyncio.sleep(0.4)
                        cdp_url = check_cdp_endpoint()
                        if cdp_url:
                            break

                if cdp_url:
                    try:
                        browser = await self.playwright.chromium.connect_over_cdp(cdp_url)
                        self.context = browser.contexts[0]
                        # Check for existing Instagram tab
                        instagram_page = None
                        for p in self.context.pages:
                            if "instagram.com" in p.url:
                                instagram_page = p
                                break
                        self.page = instagram_page or (self.context.pages[0] if self.context.pages else await self.context.new_page())
                        if "instagram.com" not in self.page.url:
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
                    except Exception as e:
                        print(f"[BrowserWorker] CDP connection error: {e}, falling back to persistent context")

            # Launch persistent browser context with native Google Chrome
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
            except Exception:
                # Fallback to bundled chromium
                self.context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=self.user_data_dir,
                    headless=False,
                    slow_mo=settings.BROWSER_SLOW_MO,
                    args=launch_args,
                    no_viewport=True
                )

            # Get or create page
            if len(self.context.pages) > 0:
                self.page = self.context.pages[0]
            else:
                self.page = await self.context.new_page()


            try:
                await self.page.bring_to_front()
            except Exception:
                pass

            self.is_running = True
            return self.page


    async def stop(self) -> None:
        async with self._lock:
            try:
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

    async def capture_live_screenshot(self) -> Optional[bytes]:
        if not self.page or self.page.is_closed():
            cdp_url = check_cdp_endpoint()
            if cdp_url:
                try:
                    await self.start()
                except Exception:
                    pass

        if not self.page or self.page.is_closed():
            return None
        try:
            return await self.page.screenshot(type="jpeg", quality=75)
        except Exception:
            return None

