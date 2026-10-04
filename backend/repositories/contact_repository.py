from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Contact, SourceRecord, Task

class ContactRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, name: str, instagram_url: str, username: Optional[str] = None,
                     message: str = "Hey", expected_followers: Optional[int] = None,
                     source_record_id: Optional[str] = None, notes: Optional[str] = None) -> Contact:
        contact = Contact(
            name=name,
            instagram_url=instagram_url,
            username=username,
            message=message,
            expected_followers=expected_followers,
            source_record_id=source_record_id,
            notes=notes
        )
        self.session.add(contact)
        await self.session.flush()
        return contact

    async def get_by_id(self, contact_id: str) -> Optional[Contact]:
        stmt = select(Contact).where(Contact.id == contact_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_instagram(self, instagram_url: str, username: Optional[str] = None) -> Optional[Contact]:
        conditions = [Contact.instagram_url == instagram_url]
        if username:
            conditions.append(Contact.username == username)
        stmt = select(Contact).where(*conditions)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(self, limit: int = 100, offset: int = 0) -> List[Contact]:
        stmt = select(Contact).order_by(Contact.created_at.desc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_with_tracking(self, limit: int = 1000, offset: int = 0) -> List[Contact]:
        from sqlalchemy.orm import selectinload
        stmt = (
            select(Contact)
            .options(
                selectinload(Contact.tasks).selectinload(Task.messages)
            )
            .order_by(Contact.name.asc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count(self) -> int:
        from sqlalchemy import func
        stmt = select(func.count(Contact.id))
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def update_replied(self, contact_id: str, status: str) -> Optional[Contact]:
        """
        Transactionally update contact reply status.
        When YES: cancels all pending/scheduled follow-ups immediately within the same transaction.
        Prevent YES -> NO from silently reopening follow-ups.
        """
        contact = await self.get_by_id(contact_id)
        if not contact:
            return None

        now = datetime.now(timezone.utc)
        values = {
            "replied_status": status,
            "updated_at": now
        }
        if status == "YES":
            values["replied_at"] = now

        stmt = update(Contact).where(Contact.id == contact_id).values(**values)
        await self.session.execute(stmt)

        # When contact replies YES: atomically cancel all pending/scheduled follow-up tasks
        if status == "YES":
            from backend.domain.enums import TaskStatus
            cancel_stmt = (
                update(Task)
                .where(
                    and_(
                        Task.contact_id == contact_id,
                        Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]),
                        Task.status.in_([
                            TaskStatus.CREATED.value,
                            TaskStatus.QUEUED.value,
                            TaskStatus.READY.value,
                            TaskStatus.RETRY_WAIT.value,
                            TaskStatus.AWAITING_APPROVAL.value,
                            TaskStatus.APPROVED.value
                        ])
                    )
                )
                .values(
                    status=TaskStatus.CANCELLED.value,
                    manual_review_reason="Cancelled: Contact replied YES",
                    updated_at=now
                )
            )
            await self.session.execute(cancel_stmt)

        await self.session.commit()
        return await self.get_by_id(contact_id)

    async def update_messages(self, contact_id: str, message: Optional[str] = None,
                              followup_1_message: Optional[str] = None,
                              followup_2_message: Optional[str] = None) -> Optional[Contact]:
        values = {"updated_at": datetime.now(timezone.utc)}
        if message is not None:
            values["message"] = message
        if followup_1_message is not None:
            values["followup_1_message"] = followup_1_message
        if followup_2_message is not None:
            values["followup_2_message"] = followup_2_message

        stmt = update(Contact).where(Contact.id == contact_id).values(**values).returning(Contact)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.scalar_one_or_none()

    async def update_bulk_templates(self, default_message: Optional[str] = None,
                                    followup_1_message: Optional[str] = None,
                                    followup_2_message: Optional[str] = None,
                                    apply_to_all: bool = False) -> int:
        values = {"updated_at": datetime.now(timezone.utc)}
        if default_message is not None:
            values["message"] = default_message
        if followup_1_message is not None:
            values["followup_1_message"] = followup_1_message
        if followup_2_message is not None:
            values["followup_2_message"] = followup_2_message

        stmt = update(Contact).values(**values)
        res = await self.session.execute(stmt)
        await self.session.commit()
        return res.rowcount
