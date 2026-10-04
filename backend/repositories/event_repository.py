from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Event
from backend.domain.enums import EventCode

class EventRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def log_event(self, event_code: EventCode | str, payload: Optional[Dict[str, Any]] = None,
                        level: str = "INFO", category: str = "AUTOMATION",
                        entity_type: Optional[str] = None, entity_id: Optional[str] = None,
                        correlation_id: Optional[str] = None) -> Event:
        code_str = event_code.value if isinstance(event_code, EventCode) else str(event_code)
        event = Event(
            timestamp=datetime.now(timezone.utc),
            level=level,
            category=category,
            entity_type=entity_type,
            entity_id=entity_id,
            event_code=code_str,
            payload_json=json.dumps(payload) if payload else None,
            correlation_id=correlation_id
        )
        self.session.add(event)
        await self.session.commit()
        return event

    async def list_events(self, limit: int = 100, offset: int = 0) -> List[Event]:
        stmt = select(Event).order_by(Event.timestamp.desc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_latest_event(self) -> Optional[Event]:
        stmt = select(Event).order_by(Event.timestamp.desc()).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
