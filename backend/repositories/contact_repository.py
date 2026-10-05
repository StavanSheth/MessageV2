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
        stmt = update(Contact).where(Contact.id == contact_id).values(
            replied_status=status,
            updated_at=datetime.now(timezone.utc)
        ).returning(Contact)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.scalar_one_or_none()

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
                                    followup_1_delay_days: Optional[int] = None,
                                    followup_2_delay_days: Optional[int] = None,
                                    apply_to_all: bool = False,
                                    reschedule_existing: bool = False) -> dict:
        values = {"updated_at": datetime.now(timezone.utc)}
        if default_message is not None:
            values["message"] = default_message
        if followup_1_message is not None:
            values["followup_1_message"] = followup_1_message
        if followup_2_message is not None:
            values["followup_2_message"] = followup_2_message
        if followup_1_delay_days is not None:
            values["followup_1_delay_days"] = followup_1_delay_days
        if followup_2_delay_days is not None:
            values["followup_2_delay_days"] = followup_2_delay_days

        stmt = update(Contact).values(**values)
        res = await self.session.execute(stmt)
        updated_contacts = res.rowcount

        rescheduled_count = 0
        if reschedule_existing and (followup_1_delay_days is not None or followup_2_delay_days is not None):
            from datetime import timedelta
            now = datetime.now(timezone.utc)
            d1 = followup_1_delay_days if followup_1_delay_days is not None else 3
            d2 = followup_2_delay_days if followup_2_delay_days is not None else 5

            # Find all pending follow-up tasks
            task_stmt = select(Task).where(
                and_(
                    Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]),
                    Task.status.in_(["READY", "CREATED", "QUEUED", "PAUSED"])
                )
            )
            tasks_res = await self.session.execute(task_stmt)
            pending_tasks = list(tasks_res.scalars().all())

            for t in pending_tasks:
                if t.type == "FOLLOW_UP_1":
                    # Check initial message task completion
                    m_task_stmt = select(Task).where(
                        and_(Task.contact_id == t.contact_id, Task.type == "MESSAGE")
                    )
                    m_task = (await self.session.execute(m_task_stmt)).scalar_one_or_none()
                    base = m_task.completed_at if (m_task and m_task.completed_at) else now
                    if base.tzinfo is None:
                        base = base.replace(tzinfo=timezone.utc)
                    t.scheduled_at = base + timedelta(days=d1)
                    t.updated_at = now
                    rescheduled_count += 1
                elif t.type == "FOLLOW_UP_2":
                    fu1_task_stmt = select(Task).where(
                        and_(Task.contact_id == t.contact_id, Task.type == "FOLLOW_UP_1")
                    )
                    fu1_task = (await self.session.execute(fu1_task_stmt)).scalar_one_or_none()
                    if fu1_task and fu1_task.completed_at:
                        base = fu1_task.completed_at
                    elif fu1_task and fu1_task.scheduled_at:
                        base = fu1_task.scheduled_at
                    else:
                        base = now
                    if base.tzinfo is None:
                        base = base.replace(tzinfo=timezone.utc)
                    t.scheduled_at = base + timedelta(days=d2)
                    t.updated_at = now
                    rescheduled_count += 1

        await self.session.commit()
        return {
            "updated_contacts_count": updated_contacts,
            "rescheduled_tasks_count": rescheduled_count
        }

    async def update_followup_schedule(
        self,
        contact_id: str,
        followup_1_scheduled_at: Optional[datetime] = None,
        followup_1_status: Optional[str] = None,
        followup_1_delay_days: Optional[int] = None,
        followup_2_scheduled_at: Optional[datetime] = None,
        followup_2_status: Optional[str] = None,
        followup_2_delay_days: Optional[int] = None,
    ) -> Optional[Contact]:
        contact = await self.get_by_id(contact_id)
        if not contact:
            return None

        now = datetime.now(timezone.utc)
        if followup_1_delay_days is not None:
            contact.followup_1_delay_days = followup_1_delay_days
        if followup_2_delay_days is not None:
            contact.followup_2_delay_days = followup_2_delay_days
        contact.updated_at = now

        # Update or create Follow-Up 1 task
        stmt_fu1 = select(Task).where(and_(Task.contact_id == contact_id, Task.type == "FOLLOW_UP_1"))
        fu1_task = (await self.session.execute(stmt_fu1)).scalar_one_or_none()

        status_map = {
            "SCHEDULED": "READY",
            "READY": "READY",
            "PAUSED": "PAUSED",
            "CANCELLED": "CANCELLED",
            "COMPLETED": "COMPLETED"
        }

        if fu1_task:
            if followup_1_scheduled_at is not None:
                fu1_task.scheduled_at = followup_1_scheduled_at
            if followup_1_status:
                fu1_task.status = status_map.get(followup_1_status.upper(), fu1_task.status)
            fu1_task.updated_at = now
        elif followup_1_scheduled_at is not None:
            new_fu1 = Task(
                contact_id=contact_id,
                type="FOLLOW_UP_1",
                sequence=2,
                priority=1,
                scheduled_at=followup_1_scheduled_at,
                status=status_map.get((followup_1_status or "READY").upper(), "READY")
            )
            self.session.add(new_fu1)

        # Update or create Follow-Up 2 task
        stmt_fu2 = select(Task).where(and_(Task.contact_id == contact_id, Task.type == "FOLLOW_UP_2"))
        fu2_task = (await self.session.execute(stmt_fu2)).scalar_one_or_none()

        if fu2_task:
            if followup_2_scheduled_at is not None:
                fu2_task.scheduled_at = followup_2_scheduled_at
            if followup_2_status:
                fu2_task.status = status_map.get(followup_2_status.upper(), fu2_task.status)
            fu2_task.updated_at = now
        elif followup_2_scheduled_at is not None:
            new_fu2 = Task(
                contact_id=contact_id,
                type="FOLLOW_UP_2",
                sequence=3,
                priority=1,
                scheduled_at=followup_2_scheduled_at,
                status=status_map.get((followup_2_status or "READY").upper(), "READY")
            )
            self.session.add(new_fu2)

        await self.session.commit()
        await self.session.refresh(contact)
        return contact

    async def delete(self, contact_id: str) -> bool:
        from sqlalchemy import delete
        from backend.database.models import Task, Message, VerificationResult
        await self.session.execute(delete(VerificationResult).where(VerificationResult.contact_id == contact_id))
        await self.session.execute(delete(Message).where(Message.contact_id == contact_id))
        await self.session.execute(delete(Task).where(Task.contact_id == contact_id))
        stmt = delete(Contact).where(Contact.id == contact_id)
        res = await self.session.execute(stmt)
        await self.session.commit()
        return res.rowcount > 0



