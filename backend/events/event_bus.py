"""
WebSocket event bus: broadcasts automation events to all connected dashboard clients.
"""
import json
import asyncio
import logging
from datetime import datetime, timezone
from typing import Set, Optional, Dict, Any
from fastapi import WebSocket
from backend.domain.enums import EventCode

logger = logging.getLogger(__name__)

class EventBus:
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)
        logger.info(f"[EventBus] Client connected. Total: {len(self._connections)}")

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)
        logger.info(f"[EventBus] Client disconnected. Total: {len(self._connections)}")

    async def broadcast(self, data: Dict[str, Any]) -> None:
        if not self._connections:
            return
        message = json.dumps(data, default=str)
        dead: Set[WebSocket] = set()
        async with self._lock:
            conns = list(self._connections)
        for ws in conns:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._connections -= dead

    async def publish(self, event_code: EventCode | str, payload: Optional[Dict[str, Any]] = None,
                      level: str = "INFO", task_id: Optional[str] = None,
                      worker_id: Optional[str] = None, contact_name: Optional[str] = None,
                      stage: Optional[str] = None) -> None:
        code = event_code.value if isinstance(event_code, EventCode) else str(event_code)
        event = {
            "type": "event",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event_code": code,
            "level": level,
            "task_id": task_id,
            "worker_id": worker_id,
            "contact_name": contact_name,
            "stage": stage,
            "payload": payload or {}
        }
        await self.broadcast(event)

    async def publish_state(self, state: Dict[str, Any]) -> None:
        await self.broadcast({"type": "state", **state})

# Singleton event bus instance
event_bus = EventBus()
