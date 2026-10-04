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
        now_dt = datetime.now(timezone.utc)
        payload_data = dict(payload or {})
        if contact_name and "contact_name" not in payload_data:
            payload_data["contact_name"] = contact_name
        if stage and "stage" not in payload_data:
            payload_data["stage"] = stage

        event = {
            "type": "event",
            "timestamp": now_dt.isoformat(),
            "event_code": code,
            "level": level,
            "task_id": task_id,
            "worker_id": worker_id,
            "contact_name": contact_name,
            "stage": stage,
            "payload": payload_data
        }
        await self.broadcast(event)

        # Persist event to database so audit logs and API history are 100% synchronized
        try:
            from backend.database.session import AsyncSessionLocal
            from backend.repositories.event_repository import EventRepository
            async with AsyncSessionLocal() as session:
                repo = EventRepository(session)
                await repo.log_event(
                    event_code=code,
                    payload=payload_data,
                    level=level,
                    category="AUTOMATION",
                    entity_type="TASK" if task_id else ("WORKER" if worker_id else None),
                    entity_id=task_id or worker_id,
                    correlation_id=task_id
                )
        except Exception as e:
            logger.debug(f"[EventBus] Could not persist event {code}: {e}")

    async def publish_state(self, state: Dict[str, Any]) -> None:
        await self.broadcast({"type": "state", **state})

# Singleton event bus instance
event_bus = EventBus()
