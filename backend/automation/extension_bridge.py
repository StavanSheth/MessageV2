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
        self._capture_lock: asyncio.Lock = asyncio.Lock()
        self._frame_event: asyncio.Event = asyncio.Event()

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
                        raw_bytes = base64.b64decode(data["data"])
                        self._latest_screenshot_data = raw_bytes
                        self._latest_screenshot_time = time.time()
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

    async def wait_for_next_frame(self, timeout: float = 1.0) -> Optional[bytes]:
        self._frame_event.clear()
        try:
            await asyncio.wait_for(self._frame_event.wait(), timeout=timeout)
            return self._latest_screenshot_data
        except asyncio.TimeoutError:
            return self._latest_screenshot_data

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
            res = await self.send_command("OPEN_PROFILE", {"url": profile_url}, timeout=25.0)
            if res.get("success"):
                return True, ResultCode.SUCCESS, "Profile opened"
            return False, ResultCode.NETWORK_ERROR, res.get("error", "Failed to open profile")
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

    async def reload_extension(self) -> Dict[str, Any]:
        if not self.is_connected:
            return {"success": False, "error": "Extension not connected"}
        return await self.send_command("RELOAD_EXTENSION", timeout=3.0)

    async def capture_screenshot(self) -> Optional[bytes]:
        if not self.is_connected:
            return self._latest_screenshot_data

        now = time.time()
        # Fast return cached frame if fresh (< 0.8s)
        if self._latest_screenshot_data and (now - self._latest_screenshot_time < 0.8):
            return self._latest_screenshot_data

        async with self._capture_lock:
            # Re-check after acquiring lock in case another task just refreshed it
            if self._latest_screenshot_data and (time.time() - self._latest_screenshot_time < 0.8):
                return self._latest_screenshot_data

            try:
                res = await self.send_command("CAPTURE_SCREENSHOT", timeout=3.0)
                if not res.get("success"):
                    logger.warning(f"[ExtensionBridge] CAPTURE_SCREENSHOT failed: {res.get('error')}")
                elif res.get("dataUrl"):
                    data_url = res["dataUrl"]
                    if "," in data_url:
                        b64_data = data_url.split(",", 1)[1]
                        raw_bytes = base64.b64decode(b64_data)
                        self._latest_screenshot_data = raw_bytes
                        self._latest_screenshot_time = time.time()
                        try:
                            latest_path = SCREENSHOTS_DIR / "latest_live.jpg"
                            latest_path.write_bytes(raw_bytes)
                        except Exception:
                            pass
                        return raw_bytes
            except Exception as e:
                logger.warning(f"[ExtensionBridge] Screenshot capture exception: {e}")
        return self._latest_screenshot_data

    async def prepare_and_send(self, message: str) -> Tuple[bool, ResultCode, str]:
        if not self.is_connected:
            return False, ResultCode.NETWORK_ERROR, "Extension not connected"
        try:
            res = await self.send_command("PREPARE_AND_SEND_MESSAGE", {"message": message}, timeout=30.0)
            if res.get("success"):
                return True, ResultCode.SUCCESS, "Message sent successfully"
            return False, ResultCode.NETWORK_ERROR, res.get("error", "Failed to send message")
        except Exception as e:
            return False, ResultCode.TIMEOUT, str(e)

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

    async def send_message(self) -> Tuple[bool, str]:
        success, code, reason = await self.bridge.prepare_and_send(self._pending_message)
        return success, reason

    async def detect_send_result(self) -> Tuple[ResultCode, str]:
        return ResultCode.SUCCESS, "Delivered"

    async def detect_result(self, expected_text: str = "") -> ResultCode:
        return ResultCode.SUCCESS

