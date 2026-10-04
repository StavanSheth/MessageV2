import json
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.session import get_db
from backend.repositories.event_repository import EventRepository
from backend.events.event_bus import event_bus
from backend.workers.instagram_worker import instagram_worker

router = APIRouter(tags=["events"])

@router.get("/api/events")
async def list_events(limit: int = 100, offset: int = 0, db: AsyncSession = Depends(get_db)):
    repo = EventRepository(db)
    events = await repo.list_events(limit=limit, offset=offset)
    return [{
        "id": e.id,
        "timestamp": e.timestamp,
        "level": e.level,
        "category": e.category,
        "entity_type": e.entity_type,
        "entity_id": e.entity_id,
        "event_code": e.event_code,
        "payload": json.loads(e.payload_json) if e.payload_json else {},
        "correlation_id": e.correlation_id
    } for e in events]

@router.websocket("/ws/events")
async def websocket_events(ws: WebSocket):
    await event_bus.connect(ws)
    try:
        # Send initial state on connect
        h = await instagram_worker.health()
        await ws.send_json({"type": "state", **h})
        # Keep connection alive
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await event_bus.disconnect(ws)
