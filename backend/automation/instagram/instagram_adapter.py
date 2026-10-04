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

    async def open_profile(self, profile_url: str, expected_username: Optional[str] = None) -> Tuple[bool, ResultCode, str]:
        """
        Navigate to target profile and verify page validity and identity.
        Requires positive evidence that the target profile actually loaded.
        """
        try:
            try:
                await self.page.bring_to_front()
            except Exception:
                pass

            await self.page.goto(profile_url, wait_until="domcontentloaded", timeout=25000)
            await asyncio.sleep(2)
            await self.dismiss_popups()

            current_url = self.page.url.lower()

            # Check for redirect to login or challenge
            if "/accounts/login" in current_url:
                return False, ResultCode.LOGIN_REQUIRED, "Redirected to login page"
            if "/challenge/" in current_url or "/two_factor/" in current_url:
                return False, ResultCode.CHALLENGE_REQUIRED, "Instagram challenge or 2FA required"

            page_text = (await self.page.locator("body").inner_text()).lower()

            # Check page not found / deleted / unavailable
            if ("sorry, this page isn't available" in page_text or
                "link you followed may be broken" in page_text or
                "page not found" in page_text or
                "user not found" in page_text):
                return False, ResultCode.PROFILE_NOT_FOUND, "Profile page not found or deleted"

            # Check action block or rate limit
            if "action blocked" in page_text or "we limit how often" in page_text or "try again later" in page_text:
                return False, ResultCode.ACTION_BLOCKED, "Action blocked by Instagram"

            # Check for private profile banner
            is_private = "this account is private" in page_text or "account is private" in page_text

            # Check for positive evidence that profile header loaded
            header = self.page.locator(InstagramSelectors.PROFILE_HEADER).first
            has_header = await header.count() > 0

            # Extract username from page to verify identity
            found_username = None
            username_elem = self.page.locator(InstagramSelectors.PROFILE_USERNAME).first
            if await username_elem.count() > 0:
                raw_text = (await username_elem.inner_text()).strip().lstrip("@")
                found_username = raw_text.split("\n")[0].strip() if raw_text else None

            if not has_header and not found_username:
                # Ambiguous DOM state: never return SUCCESS merely because navigation completed
                return False, ResultCode.UNKNOWN, "Could not positively confirm profile identity"

            # Identity verification: if expected_username provided, compare with found_username
            if expected_username and found_username:
                norm_expected = expected_username.lower().lstrip("@").strip()
                norm_found = found_username.lower().strip()
                if norm_expected != norm_found:
                    return False, ResultCode.PROFILE_MISMATCH, f"Profile mismatch: expected '{norm_expected}', loaded '{norm_found}'"

            if is_private:
                # Private profile check
                return True, ResultCode.PROFILE_PRIVATE, "Profile loaded (Account is Private)"

            return True, ResultCode.SUCCESS, "Profile verified and loaded"

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
                data["username"] = (await username_elem.inner_text()).strip().lstrip("@")

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
                    data["username"] = lines[0].lstrip("@")
                if len(lines) > 2:
                    data["bio"] = "\n".join(lines[2:])
        except Exception:
            pass

        return data

    async def check_message_availability(self) -> Tuple[bool, ResultCode, str]:
        """Check if message button exists, profile is reachable, and messaging is allowed."""
        await self.dismiss_popups()

        # Check restricted message text / action blocks
        content = (await self.page.content()).lower()
        if "action blocked" in content or "try again later" in content:
            return False, ResultCode.ACTION_BLOCKED, "Action blocked by Instagram"

        if "you can't message this account" in content or "cannot be messaged" in content:
            return False, ResultCode.DM_NOT_AVAILABLE, "Account cannot receive messages"

        for sel in InstagramSelectors.MESSAGE_BUTTON:
            btn = self.page.locator(sel).first
            if await btn.count() > 0 and await btn.is_visible():
                return True, ResultCode.SUCCESS, "Message button available"

        # Check if private account without message capability
        if "this account is private" in content:
            return False, ResultCode.PROFILE_PRIVATE, "Account is private and cannot be messaged"

        return False, ResultCode.DM_NOT_AVAILABLE, "Message button not found on profile"

    async def prepare_message(self, text: str) -> Tuple[bool, ResultCode, str]:
        """Click message, wait for composer, type text, and verify text in composer."""
        try:
            # Click message button if on profile
            if "direct" not in self.page.url:
                clicked = False
                for sel in InstagramSelectors.MESSAGE_BUTTON:
                    btn = self.page.locator(sel).first
                    if await btn.count() > 0 and await btn.is_visible():
                        try:
                            await btn.click(timeout=4000)
                        except Exception:
                            await btn.click(force=True, timeout=3000)
                        clicked = True
                        break

                if not clicked:
                    return False, ResultCode.DM_NOT_AVAILABLE, "Could not click message button"

                await asyncio.sleep(2)
                await self.dismiss_popups()

            # Locate composer (div[contenteditable='true'] / role='textbox')
            composer = None
            for _ in range(16):  # Wait up to 8 seconds
                for comp_sel in InstagramSelectors.MESSAGE_COMPOSER:
                    c = self.page.locator(comp_sel).first
                    if await c.count() > 0 and await c.is_visible():
                        composer = c
                        break
                if composer:
                    break
                await self.dismiss_popups()
                await asyncio.sleep(0.5)

            if not composer:
                return False, ResultCode.COMPOSER_UNAVAILABLE, "Message composer not found"

            # Check if composer is disabled
            is_editable = await composer.get_attribute("contenteditable")
            if is_editable == "false":
                return False, ResultCode.COMPOSER_UNAVAILABLE, "Message composer is disabled or read-only"

            # Focus composer and clear any existing draft
            await composer.click()
            await asyncio.sleep(0.3)
            await self.page.keyboard.press("Control+A")
            await self.page.keyboard.press("Backspace")
            await asyncio.sleep(0.2)

            # Type text using keyboard typing
            await self.page.keyboard.type(text, delay=30)
            await asyncio.sleep(0.5)

            # Verify text is entered in composer
            entered_val = (await composer.inner_text() or "").strip()
            text_content = (await composer.text_content() or "").strip()
            if text.strip() not in entered_val and text.strip() not in text_content:
                # Fallback to insert_text if synthetic keyboard type didn't register
                await self.page.keyboard.insert_text(text)
                await asyncio.sleep(0.4)

            return True, ResultCode.SUCCESS, "Message composer ready"
        except Exception as e:
            return False, ResultCode.SEND_FAILED, f"Prepare message failed: {str(e)}"

    async def send_message(self) -> Tuple[bool, ResultCode, str]:
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
            return True, ResultCode.SUCCESS, "Send triggered"
        except Exception as e:
            return False, ResultCode.SEND_FAILED, f"Send failed: {str(e)}"

    async def detect_result(self, expected_text: str) -> ResultCode:
        """
        Verify post-send state using multiple independent signals:
        1. Action block / rate limit detection
        2. Send failure detection (e.g. 'failed to send')
        3. Sent message bubble visible with expected_text -> SUCCESS
        4. If ambiguous (e.g. composer cleared but no message bubble verified) -> SEND_UNKNOWN
        CRITICAL: Never treat an empty composer alone as proof of success!
        """
        try:
            # 1. Check for error banners, rate limits, or action blocks
            content = (await self.page.content()).lower()
            if "action blocked" in content or "we restrict certain activity" in content:
                return ResultCode.ACTION_BLOCKED
            if "try again later" in content or "we limit how often" in content:
                return ResultCode.RATE_LIMITED
            if "failed to send" in content or "couldn't send" in content:
                return ResultCode.SEND_FAILED

            # 2. Positive confirmation: message text visible in conversation bubbles
            for bubble_sel in [f"text='{expected_text}'", InstagramSelectors.SENT_MESSAGE_BUBBLES]:
                match = self.page.locator(f"text='{expected_text}'").last
                if await match.count() > 0 and await match.is_visible():
                    return ResultCode.SUCCESS

            # 3. If confirmation is ambiguous, return SEND_UNKNOWN (never guess SUCCESS from empty composer)
            return ResultCode.SEND_UNKNOWN
        except Exception:
            return ResultCode.SEND_UNKNOWN

    async def inspect_conversation(self, expected_text: str) -> ResultCode:
        """Inspect conversation thread during reconciliation."""
        return await self.detect_result(expected_text)
