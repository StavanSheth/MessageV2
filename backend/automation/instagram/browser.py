import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any
from playwright.async_api import async_playwright, BrowserContext, Page, Playwright
from backend.config.settings import settings, SCREENSHOTS_DIR

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
            self.playwright = await async_playwright().start()

            # Launch persistent browser context (VISIBLE CHROME/CHROMIUM)
            self.context = await self.playwright.chromium.launch_persistent_context(
                user_data_dir=self.user_data_dir,
                headless=settings.BROWSER_HEADLESS,
                slow_mo=settings.BROWSER_SLOW_MO,
                viewport={"width": 1280, "height": 850},
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--start-maximized"
                ],
                no_viewport=False
            )

            # Get or create page
            if len(self.context.pages) > 0:
                self.page = self.context.pages[0]
            else:
                self.page = await self.context.new_page()

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
            title = await self.page.title()
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
