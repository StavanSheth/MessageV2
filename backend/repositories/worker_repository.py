from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import json
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Worker, Message, VerificationResult, Error

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

class MessageRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, contact_id: str, task_id: str, body: str, sequence: int = 1) -> Message:
        msg = Message(
            contact_id=contact_id,
            task_id=task_id,
            sequence=sequence,
            body=body,
            status="PENDING"
        )
        self.session.add(msg)
        await self.session.commit()
        return msg

    async def update_result(self, message_id: str, status: str, result_code: str):
        now = datetime.now(timezone.utc)
        values = {
            "status": status,
            "result_code": result_code,
            "attempted_at": now
        }
        if status == "SENT":
            values["confirmed_at"] = now
        stmt = update(Message).where(Message.id == message_id).values(**values)
        await self.session.execute(stmt)
        await self.session.commit()

class VerificationRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def record_result(self, task_id: str, contact_id: str, confidence: float,
                            decision: str, signals: List[Dict[str, Any]],
                            screenshot_path: Optional[str] = None, reason: Optional[str] = None) -> VerificationResult:
        vrf = VerificationResult(
            task_id=task_id,
            contact_id=contact_id,
            confidence=confidence,
            decision=decision,
            signals_json=json.dumps(signals),
            screenshot_path=screenshot_path,
            reason=reason
        )
        self.session.add(vrf)
        await self.session.commit()
        return vrf
