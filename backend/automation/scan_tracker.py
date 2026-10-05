"""
Tracks and persists the last scan/execution timestamp for each worker.
Persists to the `settings` table so history is never lost across server restarts,
pauses, stops, or idle periods.
"""
from datetime import datetime, timezone
from typing import Optional
import logging
from sqlalchemy import select, desc
from backend.database.session import AsyncSessionLocal
from backend.repositories.setting_repository import SettingRepository
from backend.database.models import Task

logger = logging.getLogger(__name__)

async def persist_last_scan(worker_id: str, timestamp: Optional[datetime] = None) -> str:
    now = timestamp or datetime.now(timezone.utc)
    iso_val = now.isoformat()
    try:
        async with AsyncSessionLocal() as session:
            repo = SettingRepository(session)
            await repo.set_value(f"last_scan_{worker_id}", iso_val, f"Last scan timestamp for {worker_id}")
    except Exception as e:
        logger.warning(f"[ScanTracker] Could not persist scan time for {worker_id}: {e}")
    return iso_val

async def load_last_scan(worker_id: str) -> Optional[str]:
    try:
        async with AsyncSessionLocal() as session:
            repo = SettingRepository(session)
            val = await repo.get_value(f"last_scan_{worker_id}")
            if val:
                return val

            # Fallback: check latest task for this worker or overall
            task_stmt = select(Task).order_by(desc(Task.updated_at)).limit(1)
            t = (await session.execute(task_stmt)).scalar_one_or_none()
            if t and t.updated_at:
                iso = t.updated_at.replace(tzinfo=timezone.utc).isoformat()
                await repo.set_value(f"last_scan_{worker_id}", iso, f"Initial scan timestamp from latest task")
                return iso
    except Exception as e:
        logger.warning(f"[ScanTracker] Could not load scan time for {worker_id}: {e}")
    return None
