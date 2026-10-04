import asyncio
import re
from typing import Tuple, Optional, Dict, Any
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError
from backend.automation.instagram.selectors import InstagramSelectors
from backend.domain.enums import ResultCode

class InstagramAdapter:
    def __init__(self, page: Page):
        self.page = page

    async def dismiss_popups(self) -> None:
        """Dismiss common Instagram popups like 'Turn on Notifications' or 'Save your login info'."""
        try:
            for selector in [
                "button:has-text('Save info')",
                "button:has-text('Save Info')",
                "button:has-text('Not now')",
                "button:has-text('Not Now')",
                InstagramSelectors.SAVE_INFO_NOT_NOW,
                InstagramSelectors.TURN_ON_NOTIFICATIONS_NOT_NOW
            ]:
                locator = self.page.locator(selector).first
                if await locator.count() > 0 and await locator.is_visible():
                    await locator.click()
                    await asyncio.sleep(0.5)
        except Exception:
            pass

    async def check_login(self) -> Tuple[bool, bool, bool, str]:
        """
        Returns (is_logged_in, requires_login, has_challenge, reason).
        """
        try:
            current_url = self.page.url
            if "instagram.com" not in current_url:
                await self.page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(2)

            await self.dismiss_popups()

            # 1. Check for logged-in indicators (Direct, Search, Home navigation) FIRST
            for nav_selector in [
                "svg[aria-label='Home']",
                "svg[aria-label='Messages']",
                "svg[aria-label='Direct']",
                "a[href*='/direct/inbox/']",
                InstagramSelectors.NAV_DIRECT,
                InstagramSelectors.NAV_HOME,
                InstagramSelectors.LOGGED_IN_PROFILE_ICON
            ]:
                nav = self.page.locator(nav_selector).first
                if await nav.count() > 0:
                    return True, False, False, "User is logged in"

            # 2. Check for real challenge URL or visible challenge prompt
            if "/challenge/" in current_url.lower() or "/two_factor/" in current_url.lower():
                return False, False, True, "Instagram challenge/verification required"

            try:
                body_text = (await self.page.locator("body").inner_text()).lower()
                for challenge_str in ["help us confirm you own this account", "suspicious login attempt", "security check"]:
                    if challenge_str in body_text:
                        return False, False, True, "Instagram challenge/verification required"
            except Exception:
                pass

            # 3. Check for login inputs
            username_input = self.page.locator(InstagramSelectors.LOGIN_INPUT_USERNAME).first
            password_input = self.page.locator(InstagramSelectors.LOGIN_INPUT_PASSWORD).first
            if await username_input.count() > 0 and await username_input.is_visible():
                return False, True, False, "Instagram login required"

            # 4. Check login URL
            if "instagram.com/accounts/login" in self.page.url:
                return False, True, False, "On login page"

            return True, False, False, "Session appears active"
        except Exception as e:
            return False, False, False, f"Login check error: {str(e)}"

    async def open_profile(self, profile_url: str) -> Tuple[bool, ResultCode, str]:
        """Navigate to target profile and verify page validity."""
        try:
            await self.page.goto(profile_url, wait_until="domcontentloaded", timeout=25000)
            await asyncio.sleep(2)
            await self.dismiss_popups()

            page_text = await self.page.locator("body").inner_text()
            if "sorry, this page isn't available" in page_text.lower() or "link you followed may be broken" in page_text.lower():
                return False, ResultCode.PROFILE_NOT_FOUND, "Profile page not found"

            # Check if profile header loaded
            header = self.page.locator(InstagramSelectors.PROFILE_HEADER).first
            if await header.count() > 0:
                return True, ResultCode.SUCCESS, "Profile opened"

            return True, ResultCode.SUCCESS, "Profile loaded"
        except PlaywrightTimeoutError:
            return False, ResultCode.TIMEOUT, "Timeout loading profile page"
        except Exception as e:
            return False, ResultCode.NETWORK_ERROR, str(e)

    async def extract_profile(self) -> Dict[str, Any]:
        """Extract visible username, display name, bio, and follower count."""
        data: Dict[str, Any] = {
            "username": None,
            "display_name": None,
            "bio": None,
            "followers": None,
            "url": self.page.url
        }
        try:
            # Username
            username_elem = self.page.locator(InstagramSelectors.PROFILE_USERNAME).first
            if await username_elem.count() > 0:
                data["username"] = (await username_elem.inner_text()).strip()

            # Followers
            body_text = await self.page.locator("body").inner_text()
            follower_match = re.search(r"([\d,\.kKmM]+)\s+followers", body_text, re.IGNORECASE)
            if follower_match:
                raw_followers = follower_match.group(1).replace(",", "").lower()
                if "k" in raw_followers:
                    data["followers"] = int(float(raw_followers.replace("k", "")) * 1000)
                elif "m" in raw_followers:
                    data["followers"] = int(float(raw_followers.replace("m", "")) * 1000000)
                else:
                    try:
                        data["followers"] = int(raw_followers)
                    except Exception:
                        pass

            # Display name and bio
            header = self.page.locator(InstagramSelectors.PROFILE_HEADER).first
            if await header.count() > 0:
                header_text = await header.inner_text()
                lines = [l.strip() for l in header_text.split("\n") if l.strip()]
                if len(lines) > 1 and not data["username"]:
                    data["username"] = lines[0]
                if len(lines) > 2:
                    data["bio"] = "\n".join(lines[2:])
        except Exception:
            pass

        return data

    async def check_message_availability(self) -> Tuple[bool, ResultCode, str]:
        """Check if message button exists and is clickable."""
        await self.dismiss_popups()
        for sel in InstagramSelectors.MESSAGE_BUTTON:
            btn = self.page.locator(sel).first
            if await btn.count() > 0 and await btn.is_visible():
                return True, ResultCode.SUCCESS, "Message button available"

        # Check restricted message text
        content = await self.page.content()
        if "you can't message this account" in content.lower():
            return False, ResultCode.DM_NOT_AVAILABLE, "Account cannot receive messages"

        return False, ResultCode.DM_NOT_AVAILABLE, "Message button not found on profile"

    async def prepare_message(self, text: str) -> Tuple[bool, str]:
        """Click message, wait for composer, type text, and verify text in composer."""
        try:
            # Click message button if on profile
            if "direct" not in self.page.url:
                clicked = False
                for sel in InstagramSelectors.MESSAGE_BUTTON:
                    btn = self.page.locator(sel).first
                    if await btn.count() > 0 and await btn.is_visible():
                        await btn.click()
                        clicked = True
                        break

                if not clicked:
                    return False, "Could not click message button"

                await asyncio.sleep(2)
                await self.dismiss_popups()

            # Locate composer (div[contenteditable='true'] / role='textbox')
            composer = None
            for comp_sel in InstagramSelectors.MESSAGE_COMPOSER:
                c = self.page.locator(comp_sel).first
                if await c.count() > 0 and await c.is_visible():
                    composer = c
                    break

            if not composer:
                return False, "Message composer not found"

            # Focus composer and clear any existing draft
            await composer.click()
            await asyncio.sleep(0.3)
            await self.page.keyboard.press("Control+A")
            await self.page.keyboard.press("Backspace")
            await asyncio.sleep(0.2)

            # Type text using keyboard typing
            await self.page.keyboard.type(text, delay=30)
            await asyncio.sleep(0.5)

            # Verify text is entered in composer using inner_text or text_content (avoid input_value on div)
            entered_val = (await composer.inner_text() or "").strip()
            text_content = (await composer.text_content() or "").strip()
            if text.strip() not in entered_val and text.strip() not in text_content:
                # Fallback to insert_text if synthetic keyboard type didn't register
                await self.page.keyboard.insert_text(text)
                await asyncio.sleep(0.4)

            return True, "Message composer ready"
        except Exception as e:
            return False, f"Prepare message failed: {str(e)}"

    async def send_message(self) -> Tuple[bool, str]:
        """Trigger message sending via Send button or Enter key."""
        try:
            sent = False
            # Check for Send button first
            for send_sel in InstagramSelectors.SEND_BUTTON:
                btn = self.page.locator(send_sel).first
                if await btn.count() > 0 and await btn.is_visible():
                    await btn.click()
                    sent = True
                    break

            # Fallback to pressing Enter on active composer
            if not sent:
                await self.page.keyboard.press("Enter")
                sent = True

            await asyncio.sleep(2)
            return True, "Send triggered"
        except Exception as e:
            return False, f"Send failed: {str(e)}"

    async def detect_result(self, expected_text: str) -> ResultCode:
        """Verify whether message was sent, failed, or unknown."""
        try:
            # Check for error banners or retry icons
            content = (await self.page.content()).lower()
            if "failed to send" in content or "couldn't send" in content:
                return ResultCode.SEND_FAILED

            # Check if expected message appears in conversation thread
            for bubble_sel in [f"text='{expected_text}'", InstagramSelectors.SENT_MESSAGE_BUBBLES]:
                match = self.page.locator(f"text='{expected_text}'").last
                if await match.count() > 0 and await match.is_visible():
                    return ResultCode.SUCCESS

            # Check if composer is cleared
            for comp_sel in InstagramSelectors.MESSAGE_COMPOSER:
                c = self.page.locator(comp_sel).first
                if await c.count() > 0 and await c.is_visible():
                    text_in_composer = (await c.inner_text()).strip()
                    if expected_text not in text_in_composer:
                        return ResultCode.SUCCESS

            return ResultCode.UNKNOWN
        except Exception:
            return ResultCode.UNKNOWN

    async def inspect_conversation(self, expected_text: str) -> ResultCode:
        """Inspect conversation thread during reconciliation."""
        return await self.detect_result(expected_text)
