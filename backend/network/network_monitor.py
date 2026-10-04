from enum import Enum
import asyncio
import socket
import logging
from typing import Optional
from backend.domain.enums import ResultCode, EventCode
from backend.events.event_bus import event_bus

logger = logging.getLogger(__name__)

class NetworkState(str, Enum):
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    FLAPPING = "FLAPPING"
    RECOVERING = "RECOVERING"

class NetworkMonitor:
    def __init__(self, check_host: str = "8.8.8.8", check_port: int = 53, timeout: float = 2.0):
        self.check_host = check_host
        self.check_port = check_port
        self.timeout = timeout
        self.state = NetworkState.ONLINE
        self._consecutive_failures = 0

    def is_online(self) -> bool:
        """Check direct socket connectivity to determine internet availability."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(self.timeout)
            sock.connect((self.check_host, self.check_port))
            sock.close()
            if self.state != NetworkState.ONLINE:
                logger.info("[Network] Connection recovered -> ONLINE")
                self.state = NetworkState.ONLINE
            self._consecutive_failures = 0
            return True
        except Exception:
            self._consecutive_failures += 1
            if self._consecutive_failures >= 3:
                self.state = NetworkState.OFFLINE
            else:
                self.state = NetworkState.FLAPPING
            return False

    async def wait_for_connectivity(self, max_wait_seconds: float = 30.0, check_interval: float = 2.0) -> bool:
        """Wait until network connectivity is restored or timeout expires."""
        elapsed = 0.0
        while elapsed < max_wait_seconds:
            if self.is_online():
                return True
            await asyncio.sleep(check_interval)
            elapsed += check_interval
        return False

    @staticmethod
    def classify_send_failure(network_dropped_during_send: bool) -> ResultCode:
        """
        Critical invariant: During send, NEVER classify a lost connection as NOT_SENT.
        Classify ambiguous outcome as SEND_UNKNOWN so it is reconciled rather than duplicated!
        """
        if network_dropped_during_send:
            return ResultCode.SEND_UNKNOWN
        return ResultCode.NETWORK_ERROR

network_monitor = NetworkMonitor()
