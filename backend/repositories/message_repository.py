from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Message

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

    async def list_by_contact(self, contact_id: str) -> List[Message]:
        stmt = select(Message).where(Message.contact_id == contact_id)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
