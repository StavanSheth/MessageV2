import asyncio
import json
import uuid
import logging
import base64
from datetime import datetime
from typing import Dict, Any, Optional, Tuple
from fastapi import WebSocket
from backend.domain.enums import ResultCode
from backend.config.settings import SCREENSHOTS_DIR

import time

logger = logging.getLogger("extension_bridge")

class ExtensionBridgeManager:
    def __init__(self):
        self.ws: Optional[WebSocket] = None
        self._pending_requests: Dict[str, asyncio.Future] = {}
        self._latest_screenshot_data: Optional[bytes] = None
        self._latest_screenshot_time: float = 0.0
        self._latest_outreach_data: Optional[bytes] = None
        self._latest_outreach_time: float = 0.0
        self._latest_scanner_data: Optional[bytes] = None
        self._latest_scanner_time: float = 0.0
        self._capture_lock: asyncio.Lock = asyncio.Lock()
        self._frame_event: asyncio.Event = asyncio.Event()
        self._outreach_frame_event: asyncio.Event = asyncio.Event()
        self._scanner_frame_event: asyncio.Event = asyncio.Event()

    @property
    def is_connected(self) -> bool:
        return self.ws is not None

    async def register(self, websocket: WebSocket):
        await websocket.accept()
        self.ws = websocket
        logger.info("[ExtensionBridge] Chrome Extension successfully connected!")
        try:
            while True:
                text = await websocket.receive_text()
                try:
                    data = json.loads(text)
                    if data.get("type") == "LIVE_FRAME" and data.get("data"):
                        worker_tag = data.get("worker", "outreach")
                        raw_bytes = base64.b64decode(data["data"])
                        now = time.time()
                        if worker_tag == "scanner":
                            self._latest_scanner_data = raw_bytes
                            self._latest_scanner_time = now
                            self._scanner_frame_event.set()
                        else:
                            self._latest_outreach_data = raw_bytes
                            self._latest_outreach_time = now
                            self._outreach_frame_event.set()

                        self._latest_screenshot_data = raw_bytes
                        self._latest_screenshot_time = now
                        self._frame_event.set()
                        continue

                    req_id = data.get("id")
                    if req_id and req_id in self._pending_requests:
                        future = self._pending_requests.pop(req_id)
                        if not future.done():
                            future.set_result(data)
                except Exception as e:
                    logger.error(f"[ExtensionBridge] Error processing incoming message: {e}")
        except Exception:
            logger.info("[ExtensionBridge] Chrome Extension disconnected.")
        finally:
            self.ws = None
            for req_id, future in list(self._pending_requests.items()):
                if not future.done():
                    future.set_exception(ConnectionError("Extension disconnected"))
            self._pending_requests.clear()

    async def wait_for_next_frame(self, worker: str = "outreach", timeout: float = 0.6) -> Optional[bytes]:
        evt = self._scanner_frame_event if worker in ("scanner", "replies") else self._outreach_frame_event
        data = self._latest_scanner_data if worker in ("scanner", "replies") else self._latest_outreach_data
        evt.clear()
        try:
            await asyncio.wait_for(evt.wait(), timeout=timeout)
            return self._latest_scanner_data if worker in ("scanner", "replies") else self._latest_outreach_data
        except asyncio.TimeoutError:
            return data or self._latest_screenshot_data

    async def start_screencast(self) -> Dict[str, Any]:
        if not self.is_connected:
            return {"success": False, "error": "Extension not connected"}
        return await self.send_command("START_SCREENCAST", timeout=5.0)

    async def send_command(self, action: str, payload: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> Dict[str, Any]:
        if not self.ws:
            raise ConnectionError("Chrome Extension is not connected. Please load the extension in Chrome.")

        req_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending_requests[req_id] = future

        msg = {
            "id": req_id,
            "action": action,
            "payload": payload or {}
        }
        await self.ws.send_text(json.dumps(msg))

        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending_requests.pop(req_id, None)
            raise TimeoutError(f"Extension command {action} timed out after {timeout}s")

    async def check_login(self) -> Tuple[bool, bool, bool, str]:
        if not self.is_connected:
            return False, True, False, "Extension not connected"
        try:
            res = await self.send_command("CHECK_LOGIN", timeout=10.0)
            if res.get("is_logged_in"):
                return True, False, False, f"Logged in ({res.get('url', '')})"
            return False, True, False, "Instagram login required"
        except Exception as e:
            return False, True, False, str(e)

    async def open_profile(self, profile_url: str) -> Tuple[bool, ResultCode, str]:
        if not self.is_connected:
            return False, ResultCode.NETWORK_ERROR, "Extension not connected"
        try:
            if not profile_url.startswith("http://") and not profile_url.startswith("https://"):
                clean_user = profile_url.lstrip("@").strip("/").strip()
                profile_url = f"https://www.instagram.com/{clean_user}/"
            res = await self.send_command("OPEN_PROFILE", {"url": profile_url}, timeout=25.0)
            if res.get("not_found"):
                return False, ResultCode.PROFILE_NOT_FOUND, res.get("error", "Profile not found: Sorry, this page isn't available. The link you followed may be broken, or the page may have been removed.")
            if res.get("login_required"):
                return False, ResultCode.LOGIN_REQUIRED, res.get("error", "Instagram login required")
            if res.get("challenge_required"):
                return False, ResultCode.CHALLENGE_REQUIRED, res.get("error", "Instagram challenge/verification required")
            if res.get("success"):
                return True, ResultCode.SUCCESS, "Profile opened"

            err = res.get("error", "Failed to open profile")
            lower_err = err.lower()
            if "not available" in lower_err or "not found" in lower_err or "broken" in lower_err or "removed" in lower_err:
                return False, ResultCode.PROFILE_NOT_FOUND, err
            return False, ResultCode.NETWORK_ERROR, err
        except Exception as e:
            return False, ResultCode.TIMEOUT, str(e)

    async def extract_profile(self) -> Dict[str, Any]:
        if not self.is_connected:
            return {}
        try:
            res = await self.send_command("EXTRACT_PROFILE", timeout=10.0)
            return res.get("data", {})
        except Exception:
            return {}

    async def check_message_availability(self) -> Tuple[bool, ResultCode, str]:
        if not self.is_connected:
            return False, ResultCode.DM_NOT_AVAILABLE, "Extension not connected"
        try:
            res = await self.send_command("CHECK_MESSAGE_AVAILABILITY", timeout=10.0)
            if res.get("available"):
                return True, ResultCode.SUCCESS, "Message button available"
            return False, ResultCode.DM_NOT_AVAILABLE, "Message button not found on profile"
        except Exception as e:
            return False, ResultCode.DM_NOT_AVAILABLE, str(e)

    async def abort_current_action(self) -> Dict[str, Any]:
        if not self.is_connected:
            return {"success": False, "error": "Extension not connected"}
        try:
            return await self.send_command("ABORT_CURRENT_ACTION", timeout=3.0)
        except Exception as e:
            logger.warning(f"[ExtensionBridge] abort_current_action notice: {e}")
            return {"success": False, "error": str(e)}

    async def reload_extension(self) -> Dict[str, Any]:
        if not self.is_connected:
            return {"success": False, "error": "Extension not connected"}
        return await self.send_command("RELOAD_EXTENSION", timeout=3.0)

    async def capture_screenshot(self, worker: str = "outreach") -> Optional[bytes]:
        is_scanner = worker in ("scanner", "replies")
        cached_data = self._latest_scanner_data if is_scanner else self._latest_outreach_data
        cached_time = self._latest_scanner_time if is_scanner else self._latest_outreach_time
        now = time.time()
        # Fast return cached frame if fresh (< 0.8s)
        if cached_data and (now - cached_time < 0.8):
            return cached_data

        if not self.is_connected:
            return cached_data or self._latest_screenshot_data

        async with self._capture_lock:
            cached_data = self._latest_scanner_data if is_scanner else self._latest_outreach_data
            cached_time = self._latest_scanner_time if is_scanner else self._latest_outreach_time
            if cached_data and (time.time() - cached_time < 0.8):
                return cached_data

            try:
                target_tag = "scanner" if is_scanner else "outreach"
                res = await self.send_command("CAPTURE_SCREENSHOT", payload={"worker": target_tag}, timeout=3.0)
                if not res.get("success"):
                    logger.warning(f"[ExtensionBridge] CAPTURE_SCREENSHOT failed: {res.get('error')}")
                elif res.get("dataUrl"):
                    data_url = res["dataUrl"]
                    if "," in data_url:
                        b64_data = data_url.split(",", 1)[1]
                        raw_bytes = base64.b64decode(b64_data)
                        if is_scanner:
                            self._latest_scanner_data = raw_bytes
                            self._latest_scanner_time = time.time()
                        else:
                            self._latest_outreach_data = raw_bytes
                            self._latest_outreach_time = time.time()
                        self._latest_screenshot_data = raw_bytes
                        self._latest_screenshot_time = time.time()
                        try:
                            filename = f"latest_{target_tag}.jpg"
                            (SCREENSHOTS_DIR / filename).write_bytes(raw_bytes)
                        except Exception:
                            pass
                        return raw_bytes
            except Exception as e:
                logger.warning(f"[ExtensionBridge] Screenshot capture exception: {e}")
        return cached_data or self._latest_screenshot_data

    async def prepare_and_send(self, message: str, check_history: bool = True, task_type: str = "MESSAGE") -> Tuple[bool, ResultCode, str, bool, bool]:
        """Returns (success, code, reason, already_messaged, dm_restricted)"""
        if not self.is_connected:
            return False, ResultCode.NETWORK_ERROR, "Extension not connected", False, False
        try:
            res = await self.send_command("PREPARE_AND_SEND_MESSAGE", {
                "message": message,
                "check_history": check_history,
                "task_type": task_type
            }, timeout=30.0)
            if res.get("aborted"):
                return False, ResultCode.TASK_CANCELLED, res.get("error", "Operation aborted by user"), False, False
            if res.get("dm_restricted"):
                return False, ResultCode.DM_NOT_AVAILABLE, res.get("error", "This account can't receive your message requests"), False, True
            if res.get("already_messaged"):
                return False, ResultCode.DM_NOT_AVAILABLE, res.get("error", "Existing conversation history detected"), True, False
            if res.get("success"):
                return True, ResultCode.SUCCESS, "Message sent successfully", False, False
            return False, ResultCode.NETWORK_ERROR, res.get("error", "Failed to send message"), False, False
        except Exception as e:
            return False, ResultCode.TIMEOUT, str(e), False, False

    async def scan_inbox_replies(self) -> Dict[str, Any]:
        if not self.is_connected:
            return {"success": False, "error": "Extension not connected"}
        return await self.send_command("SCAN_INBOX_REPLIES", timeout=25.0)

    async def inspect_thread_reply(self, thread_url: str) -> Dict[str, Any]:
        if not self.is_connected:
            return {"success": False, "error": "Extension not connected"}
        return await self.send_command("INSPECT_THREAD_REPLY", {"thread_url": thread_url}, timeout=25.0)

    async def inspect_current_conversation(self, worker: str = "outreach") -> Dict[str, Any]:
        if not self.is_connected:
            return {"success": False, "error": "Extension not connected"}
        return await self.send_command("INSPECT_CONVERSATION", {"worker": worker}, timeout=25.0)

# Global singleton
extension_bridge = ExtensionBridgeManager()

class ExtensionAdapter:
    def __init__(self, bridge: ExtensionBridgeManager = extension_bridge):
        self.bridge = bridge
        self.page = None
        self._pending_message: str = ""

    async def screenshot(self, label: str = "capture") -> Optional[str]:
        raw_bytes = await self.bridge.capture_screenshot()
        if raw_bytes:
            filename = f"{label}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
            try:
                path = SCREENSHOTS_DIR / filename
                path.write_bytes(raw_bytes)
                return filename
            except Exception:
                pass
        return None

    async def dismiss_popups(self) -> None:
        pass

    async def check_login(self) -> Tuple[bool, bool, bool, str]:
        return await self.bridge.check_login()

    async def open_profile(self, profile_url: str) -> Tuple[bool, ResultCode, str]:
        return await self.bridge.open_profile(profile_url)

    async def extract_profile(self) -> Dict[str, Any]:
        return await self.bridge.extract_profile()

    async def check_message_availability(self) -> Tuple[bool, ResultCode, str]:
        return await self.bridge.check_message_availability()

    async def prepare_message(self, text: str) -> Tuple[bool, str]:
        self._pending_message = text
        return True, "Prepared"

    async def send_message(self, check_history: bool = True, task_type: str = "MESSAGE") -> Tuple[bool, str, bool, bool]:
        success, code, reason, already_messaged, dm_restricted = await self.bridge.prepare_and_send(
            self._pending_message, check_history=check_history, task_type=task_type
        )
        self._last_send_success = success
        self._last_send_code = code
        self._last_send_reason = reason
        return success, reason, already_messaged, dm_restricted

    async def scan_inbox(self) -> Dict[str, Any]:
        return await self.bridge.scan_inbox_replies()

    async def inspect_thread(self, thread_url: str) -> Dict[str, Any]:
        return await self.bridge.inspect_thread_reply(thread_url)

    async def inspect_conversation(self, worker: str = "outreach") -> Dict[str, Any]:
        return await self.bridge.inspect_current_conversation(worker=worker)

    async def detect_send_result(self) -> Tuple[ResultCode, str]:
        if not getattr(self, "_last_send_success", True):
            return getattr(self, "_last_send_code", ResultCode.NETWORK_ERROR), getattr(self, "_last_send_reason", "Failed")
        return ResultCode.SUCCESS, "Delivered"

    async def detect_result(self, expected_text: str = "") -> ResultCode:
        if not getattr(self, "_last_send_success", True):
            return getattr(self, "_last_send_code", ResultCode.NETWORK_ERROR)
        return ResultCode.SUCCESS

