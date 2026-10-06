from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Worker

# Re-export for backwards compatibility across existing workers
from backend.repositories.message_repository import MessageRepository
from backend.repositories.verification_repository import VerificationRepository

class WorkerRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_or_create(self, worker_id: str, name: str = "Instagram Worker 01") -> Worker:
        stmt = select(Worker).where(Worker.id == worker_id)
        result = await self.session.execute(stmt)
        worker = result.scalar_one_or_none()
        if not worker:
            worker = Worker(
                id=worker_id,
                name=name,
                status="IDLE",
                browser_status="DISCONNECTED",
                instagram_login_status="UNKNOWN",
                current_stage="IDLE"
            )
            self.session.add(worker)
            await self.session.commit()
        return worker

    async def update_status(self, worker_id: str, **kwargs) -> Optional[Worker]:
        kwargs["updated_at"] = datetime.now(timezone.utc)
        kwargs["last_heartbeat_at"] = datetime.now(timezone.utc)
        stmt = update(Worker).where(Worker.id == worker_id).values(**kwargs)
        await self.session.execute(stmt)
        await self.session.commit()
        return await self.get_or_create(worker_id)

    async def list_workers(self) -> List[Worker]:
        stmt = select(Worker)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

__all__ = ["WorkerRepository", "MessageRepository", "VerificationRepository"]
