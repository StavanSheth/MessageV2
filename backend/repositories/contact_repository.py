from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy import select, update, and_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Contact, SourceRecord, Task
from backend.domain.enums import TaskStatus

class ContactRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, name: str, instagram_url: str, username: Optional[str] = None,
                     message: str = "Hey", expected_followers: Optional[int] = None,
                     source_record_id: Optional[str] = None, notes: Optional[str] = None,
                     followup_1_message: Optional[str] = None, followup_1_delay_days: int = 3,
                     followup_2_message: Optional[str] = None, followup_2_delay_days: int = 5,
                     replied_status: str = "UNKNOWN") -> Contact:
        if instagram_url:
            clean_val = str(instagram_url).strip()
            if not clean_val.startswith("http://") and not clean_val.startswith("https://"):
                clean_user = clean_val.lstrip("@").strip("/").strip()
                instagram_url = f"https://www.instagram.com/{clean_user}/"
                if not username:
                    username = clean_user
        if not username and instagram_url:
            import re
            m = re.search(r"instagram\.com/([a-zA-Z0-9_\.\-]+)", instagram_url)
            if m and m.group(1).lower() not in ["p", "reel", "stories", "direct", "explore"]:
                username = m.group(1).strip()

        contact = Contact(
            name=name,
            instagram_url=instagram_url,
            username=username,
            message=message,
            expected_followers=expected_followers,
            source_record_id=source_record_id,
            notes=notes,
            followup_1_message=followup_1_message,
            followup_1_delay_days=followup_1_delay_days,
            followup_2_message=followup_2_message,
            followup_2_delay_days=followup_2_delay_days,
            replied_status=replied_status
        )
        self.session.add(contact)
        await self.session.flush()
        return contact

    async def get_by_id(self, contact_id: str) -> Optional[Contact]:
        stmt = select(Contact).where(Contact.id == contact_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_instagram(self, instagram_url: str, username: Optional[str] = None) -> Optional[Contact]:
        from sqlalchemy import or_, func
        conditions = []
        if instagram_url:
            clean_url = str(instagram_url).split("?")[0].split("#")[0].rstrip("/").lower()
            conditions.append(func.lower(Contact.instagram_url).like(f"{clean_url}%"))
        if username:
            clean_user = str(username).lstrip("@").strip().lower()
            conditions.append(func.lower(Contact.username) == clean_user)
        if not conditions:
            return None
        stmt = select(Contact).where(or_(*conditions))
        result = await self.session.execute(stmt)
        return result.scalars().first()

    async def update_contact_details(
        self,
        contact_id: str,
        name: Optional[str] = None,
        username: Optional[str] = None,
        instagram_url: Optional[str] = None,
        notes: Optional[str] = None,
        expected_followers: Optional[int] = None,
        is_archived: Optional[bool] = None,
        data: Optional[dict] = None
    ) -> Optional[Contact]:
        contact = await self.get_by_id(contact_id)
        if not contact:
            return None

        payload = {}
        if name is not None: payload["name"] = name
        if username is not None: payload["username"] = username
        if instagram_url is not None: payload["instagram_url"] = instagram_url
        if notes is not None: payload["notes"] = notes
        if expected_followers is not None: payload["expected_followers"] = expected_followers
        if is_archived is not None: payload["is_archived"] = is_archived
        if data:
            payload.update(data)

        for k, v in payload.items():
            if v is None:
                continue
            if k == "name":
                contact.name = str(v).strip()
            elif k == "username":
                contact.username = str(v).lstrip("@").strip()
            elif k == "instagram_url":
                try:
                    from backend.sources.xlsx.adapter import LocalXlsxSource
                    can_url, can_user = LocalXlsxSource._format_instagram_url(v)
                    contact.instagram_url = can_url or str(v).strip()
                    if can_user and not contact.username:
                        contact.username = can_user
                except Exception:
                    clean_val = str(v).strip()
                    if not clean_val.startswith("http://") and not clean_val.startswith("https://"):
                        clean_user = clean_val.lstrip("@").strip("/").strip()
                        contact.instagram_url = f"https://www.instagram.com/{clean_user}/"
                        if not contact.username:
                            contact.username = clean_user
                    else:
                        contact.instagram_url = clean_val
            elif hasattr(contact, k):
                setattr(contact, k, v)

        contact.updated_at = datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(contact)
        return contact

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
        now = datetime.now(timezone.utc)
        values = {
            "replied_status": status,
            "updated_at": now
        }
        if status in ["YES", "AUTOMATED_MESSAGE"]:
            values["replied_at"] = now
            values["reply_detected_at"] = now
            # Atomically cancel any pending/ready follow-ups for this contact
            cancel_stmt = (
                update(Task)
                .where(
                    and_(
                        Task.contact_id == contact_id,
                        Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]),
                        Task.status.in_([
                            TaskStatus.READY.value, TaskStatus.CREATED.value,
                            TaskStatus.QUEUED.value, TaskStatus.MANUAL_REVIEW.value,
                            TaskStatus.RETRY_WAIT.value, TaskStatus.PAUSED.value
                        ])
                    )
                )
                .values(
                    status=TaskStatus.CANCELLED.value,
                    manual_review_reason=f"Cancelled: Contact replied {status}",
                    updated_at=now
                )
            )
            await self.session.execute(cancel_stmt)

        stmt = update(Contact).where(Contact.id == contact_id).values(**values).returning(Contact)
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
                    if fu1_task and fu1_task.status in ["CANCELLED", "SKIPPED", "FAILED"]:
                        t.status = "CANCELLED"
                        t.manual_review_reason = "Cancelled: Follow-Up 1 was cancelled or not completed"
                        t.updated_at = now
                        rescheduled_count += 1
                        continue
                    elif fu1_task and fu1_task.completed_at:
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
        from backend.database.models import Task, Message, VerificationResult, OutreachHistory, SendAttempt
        contact = await self.get_by_id(contact_id)
        if contact:
            try:
                self.session.add(OutreachHistory(
                    username=contact.username,
                    instagram_url=contact.instagram_url,
                    contact_name=contact.name,
                    action="ARCHIVED",
                    details="Contact deleted"
                ))
            except Exception:
                pass
        await self.session.execute(delete(VerificationResult).where(VerificationResult.contact_id == contact_id))
        await self.session.execute(delete(SendAttempt).where(SendAttempt.contact_id == contact_id))
        await self.session.execute(delete(Message).where(Message.contact_id == contact_id))
        await self.session.execute(delete(Task).where(Task.contact_id == contact_id))
        stmt = delete(Contact).where(Contact.id == contact_id)
        res = await self.session.execute(stmt)
        await self.session.commit()
        return res.rowcount > 0

    async def bulk_delete(self, contact_ids: List[str]) -> int:
        from sqlalchemy import delete
        from backend.database.models import Task, Message, VerificationResult, OutreachHistory, SendAttempt
        if not contact_ids:
            return 0
        c_stmt = select(Contact).where(Contact.id.in_(contact_ids))
        contacts = (await self.session.execute(c_stmt)).scalars().all()
        for c in contacts:
            try:
                self.session.add(OutreachHistory(
                    username=c.username,
                    instagram_url=c.instagram_url,
                    contact_name=c.name,
                    action="ARCHIVED",
                    details="Contact bulk deleted"
                ))
            except Exception:
                pass
        await self.session.execute(delete(VerificationResult).where(VerificationResult.contact_id.in_(contact_ids)))
        await self.session.execute(delete(SendAttempt).where(SendAttempt.contact_id.in_(contact_ids)))
        await self.session.execute(delete(Message).where(Message.contact_id.in_(contact_ids)))
        await self.session.execute(delete(Task).where(Task.contact_id.in_(contact_ids)))
        res = await self.session.execute(delete(Contact).where(Contact.id.in_(contact_ids)))
        await self.session.commit()
        return res.rowcount

    async def clear_all(self) -> int:
        from sqlalchemy import delete
        from backend.database.models import Task, Message, VerificationResult, OutreachHistory, SendAttempt
        all_contacts = (await self.session.execute(select(Contact))).scalars().all()
        for c in all_contacts:
            try:
                self.session.add(OutreachHistory(
                    username=c.username,
                    instagram_url=c.instagram_url,
                    contact_name=c.name,
                    action="ARCHIVED",
                    details="Contact cleared in DB wipe"
                ))
            except Exception:
                pass
        await self.session.execute(delete(VerificationResult))
        await self.session.execute(delete(SendAttempt))
        await self.session.execute(delete(Message))
        await self.session.execute(delete(Task))
        res = await self.session.execute(delete(Contact))
        await self.session.commit()
        return res.rowcount

    async def bulk_update_replied(self, status: str, contact_ids: Optional[List[str]] = None) -> int:
        now = datetime.now(timezone.utc)
        stmt = update(Contact).values(replied_status=status, updated_at=now)
        if contact_ids:
            stmt = stmt.where(Contact.id.in_(contact_ids))
        res = await self.session.execute(stmt)
        count = res.rowcount

        # If transitioning to NO or UNKNOWN, revive cancelled follow-up tasks back to READY
        if status in ("NO", "UNKNOWN"):
            conditions = [
                Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]),
                Task.status == TaskStatus.CANCELLED.value,
                Task.manual_review_reason.like("%replied%")
            ]
            if contact_ids:
                conditions.append(Task.contact_id.in_(contact_ids))
            revive_stmt = update(Task).where(and_(*conditions)).values(
                status=TaskStatus.READY.value,
                manual_review_reason=None,
                updated_at=now
            )
            await self.session.execute(revive_stmt)

        await self.session.commit()
        return count



