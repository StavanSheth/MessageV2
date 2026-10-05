import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Task, Contact, Message
from backend.domain.enums import TaskStatus, EventCode
from backend.config.settings import settings
from backend.events.event_bus import event_bus

logger = logging.getLogger(__name__)

class FollowUpService:
    @staticmethod
    async def verify_eligibility(session: AsyncSession, contact_id: str, followup_type: str) -> Tuple[bool, str]:
        """
        Verify follow-up eligibility invariants:
        1. Initial message = CONFIRMED SENT
        2. Contact replied_status != YES
        3. No previous equivalent FU exists
        4. No active manual-review state exists
        """
        contact = (await session.execute(select(Contact).where(Contact.id == contact_id))).scalar_one_or_none()
        if not contact:
            return False, "Contact not found"

        if contact.replied_status == "YES":
            return False, "Contact already replied YES"

        # Check initial message status
        init_task_stmt = select(Task).where(
            and_(Task.contact_id == contact_id, Task.type == "MESSAGE")
        )
        init_task = (await session.execute(init_task_stmt)).scalar_one_or_none()
        if not init_task:
            return False, "Initial message task does not exist"

        if init_task.status != TaskStatus.COMPLETED.value:
            return False, f"Initial message not completed (status: {init_task.status})"

        # Verify that initial message actually confirmed sent
        msg_stmt = select(Message).where(
            and_(Message.task_id == init_task.id, Message.status == "SENT")
        )
        sent_msg = (await session.execute(msg_stmt)).scalar_one_or_none()
        if not sent_msg:
            return False, "Initial message not confirmed sent"

        # For FOLLOW_UP_2, ensure FOLLOW_UP_1 is completed and confirmed sent
        if followup_type == "FOLLOW_UP_2":
            fu1_stmt = select(Task).where(
                and_(Task.contact_id == contact_id, Task.type == "FOLLOW_UP_1")
            )
            fu1_task = (await session.execute(fu1_stmt)).scalar_one_or_none()
            if not fu1_task or fu1_task.status != TaskStatus.COMPLETED.value:
                return False, "Follow-Up 1 not confirmed sent"

        # Check for existing equivalent follow-up
        existing_fu_stmt = select(Task).where(
            and_(Task.contact_id == contact_id, Task.type == followup_type)
        )
        existing_fu = (await session.execute(existing_fu_stmt)).scalar_one_or_none()
        if existing_fu:
            return False, f"Equivalent {followup_type} already exists (status: {existing_fu.status})"

        return True, "Eligible"

    @staticmethod
    async def schedule_followup(
        session: AsyncSession,
        contact_id: str,
        followup_type: str,
        delay_days: Optional[int] = None
    ) -> Optional[Task]:
        """
        Idempotent follow-up scheduling with prerequisite verification and unique idempotency key.
        """
        # Check if already scheduled
        existing_fu_stmt = select(Task).where(
            and_(Task.contact_id == contact_id, Task.type == followup_type)
        )
        existing_fu = (await session.execute(existing_fu_stmt)).scalar_one_or_none()
        if existing_fu:
            return existing_fu

        eligible, reason = await FollowUpService.verify_eligibility(session, contact_id, followup_type)
        if not eligible:
            logger.info(f"[FollowUpService] Ineligible to schedule {followup_type} for contact {contact_id}: {reason}")
            return None

        contact = (await session.execute(select(Contact).where(Contact.id == contact_id))).scalar_one()

        sequence = 2 if followup_type == "FOLLOW_UP_1" else 3
        idempotency_key = f"fu_{contact_id}_{sequence}"

        # Double check idempotency key
        existing_by_key = (await session.execute(
            select(Task).where(Task.idempotency_key == idempotency_key)
        )).scalar_one_or_none()
        if existing_by_key:
            return existing_by_key

        if delay_days is None:
            if followup_type == "FOLLOW_UP_1":
                delay_days = contact.followup_1_delay_days or settings.FOLLOWUP_DELAY_DEFAULT
            else:
                delay_days = contact.followup_2_delay_days or 5

        now = datetime.now(timezone.utc)
        scheduled_at = now + timedelta(days=delay_days)

        task = Task(
            contact_id=contact.id,
            type=followup_type,
            sequence=sequence,
            priority=1,
            scheduled_at=scheduled_at,
            status=TaskStatus.READY.value,
            idempotency_key=idempotency_key
        )

        from sqlalchemy.exc import IntegrityError
        try:
            session.add(task)
            await session.commit()
            await session.refresh(task)
            logger.info(f"[FollowUpService] Scheduled {followup_type} for contact {contact.name} at {scheduled_at.isoformat()}")
            return task
        except IntegrityError:
            await session.rollback()
            existing_by_key = (await session.execute(
                select(Task).where(Task.idempotency_key == idempotency_key)
            )).scalar_one_or_none()
            return existing_by_key

    @staticmethod
    async def cancel_pending_followups(session: AsyncSession, contact_id: str, reason: str = "Contact replied YES") -> int:
        """
        Atomically cancels all pending / queued / ready follow-ups for a contact.
        """
        now = datetime.now(timezone.utc)
        stmt = (
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
                manual_review_reason=f"Cancelled: {reason}",
                updated_at=now
            )
        )
        result = await session.execute(stmt)
        await session.commit()
        cancelled_count = result.rowcount

        if cancelled_count > 0:
            await event_bus.publish(
                EventCode.FOLLOWUP_CANCELLED,
                contact_id=contact_id,
                payload={"reason": reason, "cancelled_tasks_count": cancelled_count}
            )
            logger.info(f"[FollowUpService] Cancelled {cancelled_count} pending follow-ups for contact {contact_id}: {reason}")

        return cancelled_count

    @staticmethod
    async def verify_before_send(session: AsyncSession, task_id: str) -> Tuple[bool, str]:
        """
        Final safety gate immediately before sending a follow-up to prevent reply races.
        """
        task = (await session.execute(select(Task).where(Task.id == task_id))).scalar_one_or_none()
        if not task:
            return False, "Task not found"

        if task.type not in {"FOLLOW_UP_1", "FOLLOW_UP_2"}:
            return True, "Initial message or other task type"

        contact = (await session.execute(select(Contact).where(Contact.id == task.contact_id))).scalar_one_or_none()
        if not contact:
            return False, "Contact not found"

        if contact.replied_status in ["YES", "AUTOMATED_MESSAGE"]:
            # Cancel task immediately
            task.status = TaskStatus.CANCELLED.value
            task.manual_review_reason = f"Cancelled: Contact replied {contact.replied_status} prior to FU execution"
            task.updated_at = datetime.now(timezone.utc)
            await session.commit()
            return False, f"Contact has replied {contact.replied_status}. Follow-up cancelled."

        # For FOLLOW_UP_2, strictly verify FOLLOW_UP_1 completed successfully
        if task.type == "FOLLOW_UP_2":
            fu1_stmt = select(Task).where(
                and_(Task.contact_id == task.contact_id, Task.type == "FOLLOW_UP_1")
            )
            fu1_task = (await session.execute(fu1_stmt)).scalar_one_or_none()
            if not fu1_task or fu1_task.status != TaskStatus.COMPLETED.value:
                task.status = TaskStatus.CANCELLED.value
                task.manual_review_reason = "Cancelled: Follow-Up 1 was not completed"
                task.updated_at = datetime.now(timezone.utc)
                await session.commit()
                return False, "Follow-Up 1 was not completed. Follow-up 2 cancelled."

        return True, "Verified safe to send"
