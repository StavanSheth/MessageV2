"""
RecoveryService: handles interrupted tasks, unknown send results, worker crash recovery,
and startup reconciliation.
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from sqlalchemy import select, and_, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Task, Message, Contact
from backend.repositories.task_repository import TaskRepository
from backend.domain.enums import TaskStatus, EventCode, ResultCode
from backend.events.event_bus import event_bus

logger = logging.getLogger(__name__)

class RecoveryService:
    def __init__(self, session: AsyncSession, bus=None):
        self.session = session
        self.event_bus = bus or event_bus
        self.task_repo = TaskRepository(session)

    async def reconcile_on_startup(self) -> Dict[str, Any]:
        """
        On backend startup:
        Locate RUNNING, SENDING, UNKNOWN, RECONCILING tasks.
        Classify each task:
        - If task was SENDING or has a Message record created: mark as RECONCILING (do not assume NOT_SENT).
        - If task was RUNNING / VERIFYING with NO message record: safe to reset to READY.
        - If task was already RECONCILING or MANUAL_REVIEW: keep for reconciliation / manual review.
        """
        affected = {
            "reconciling": [],
            "reset_to_ready": [],
            "manual_review": []
        }

        # Query all tasks in non-terminal transient execution states
        stmt = select(Task).where(
            Task.status.in_([
                TaskStatus.RUNNING.value,
                TaskStatus.SENDING.value,
                TaskStatus.VERIFYING.value,
                TaskStatus.RECONCILING.value
            ])
        )
        tasks = (await self.session.execute(stmt)).scalars().all()

        for task in tasks:
            # Check if there is an associated Message record indicating a send attempt
            msg_stmt = select(Message).where(Message.task_id == task.id)
            messages = (await self.session.execute(msg_stmt)).scalars().all()
            has_send_attempt = len(messages) > 0 or task.send_attempt_id is not None or task.status == TaskStatus.SENDING.value

            if has_send_attempt:
                # Invariant: Never convert a task that might have been sent directly to READY!
                task.status = TaskStatus.RECONCILING.value
                task.reconciliation_status = "PENDING_CONVERSATION_INSPECTION"
                task.manual_review_reason = "Application restart during or after message send attempt. Reconcile before retry."
                task.updated_at = datetime.now(timezone.utc)
                affected["reconciling"].append(task.id)
                logger.warning(f"[Recovery] Task {task.id} moved to RECONCILING (send attempt detected on startup)")
                if self.event_bus:
                    await self.event_bus.publish(
                        EventCode.RECONCILIATION_STARTED,
                        task_id=task.id,
                        payload={"reason": "Application restart during/after send attempt"}
                    )
            else:
                # No send attempt made: safe to reset to READY
                task.status = TaskStatus.READY.value
                task.lease_owner = None
                task.lease_expires_at = None
                task.updated_at = datetime.now(timezone.utc)
                affected["reset_to_ready"].append(task.id)
                logger.info(f"[Recovery] Task {task.id} safely reset to READY (no send attempt was made)")

        await self.session.commit()
        return affected

    async def reconcile_task_with_conversation(
        self,
        task_id: str,
        adapter=None,
        expected_text: Optional[str] = None
    ) -> str:
        """
        Inspect the target conversation on Instagram to determine whether the message was sent.
        Returns: CONFIRMED, NOT_SENT, or MANUAL_REVIEW.
        """
        task = await self.task_repo.get_by_id(task_id)
        if not task:
            return "MANUAL_REVIEW"

        now = datetime.now(timezone.utc)

        if not expected_text:
            # Look up expected message text from Contact or Message table
            msg_stmt = select(Message).where(Message.task_id == task_id).order_by(Message.created_at.desc())
            msg = (await self.session.execute(msg_stmt)).scalars().first()
            if msg and msg.body:
                expected_text = msg.body
            elif task.contact:
                if task.type == "FOLLOW_UP_1":
                    expected_text = task.contact.followup_1_message
                elif task.type == "FOLLOW_UP_2":
                    expected_text = task.contact.followup_2_message
                else:
                    expected_text = task.contact.message
            expected_text = expected_text or "Hey"

        if adapter:
            try:
                result = await adapter.inspect_conversation(expected_text)
                if result == ResultCode.SUCCESS:
                    # Message confirmed in conversation!
                    task.status = TaskStatus.COMPLETED.value
                    task.reconciliation_status = "CONFIRMED_SENT"
                    task.completed_at = now
                    task.updated_at = now

                    # Update Message record
                    msg_stmt = select(Message).where(Message.task_id == task_id).order_by(Message.created_at.desc())
                    msg = (await self.session.execute(msg_stmt)).scalars().first()
                    if msg:
                        msg.status = "SENT"
                        msg.confirmed_at = now

                    await self.session.commit()

                    if self.event_bus:
                        await self.event_bus.publish(
                            EventCode.RECONCILIATION_CONFIRMED,
                            task_id=task_id,
                            payload={"result": "CONFIRMED_SENT"}
                        )
                    logger.info(f"[Recovery] Task {task_id} successfully reconciled as CONFIRMED_SENT")
                    return "CONFIRMED"

                elif result in {ResultCode.SEND_FAILED, ResultCode.PROFILE_NOT_FOUND}:
                    # Message positively confirmed NOT sent
                    task.status = TaskStatus.READY.value
                    task.reconciliation_status = "CONFIRMED_NOT_SENT"
                    task.updated_at = now
                    await self.session.commit()

                    if self.event_bus:
                        await self.event_bus.publish(
                            EventCode.RECONCILIATION_CONFIRMED,
                            task_id=task_id,
                            payload={"result": "NOT_SENT_RESET_TO_READY"}
                        )
                    logger.info(f"[Recovery] Task {task_id} reconciled as NOT_SENT, returned to READY")
                    return "NOT_SENT"

            except Exception as e:
                logger.error(f"[Recovery] Conversation inspection failed for task {task_id}: {e}")

        # Ambiguous outcome -> MANUAL_REVIEW
        task.status = TaskStatus.MANUAL_REVIEW.value
        task.reconciliation_status = "AMBIGUOUS_MANUAL_REVIEW"
        task.manual_review_reason = "Ambiguous send state after reconciliation attempt. Operator intervention required."
        task.updated_at = now
        await self.session.commit()

        if self.event_bus:
            await self.event_bus.publish(
                EventCode.RECONCILIATION_FAILED,
                task_id=task_id,
                payload={"reason": "Ambiguous outcome"}
            )
        logger.warning(f"[Recovery] Task {task_id} marked MANUAL_REVIEW due to ambiguous reconciliation")
        return "MANUAL_REVIEW"

    async def handle_browser_crash(self, active_task_id: Optional[str]) -> None:
        """
        Handle browser disconnect / crash deterministically:
        Never send a message merely because browser recovery succeeded.
        Mark active task as RECONCILING if a send was attempted, or READY if not yet sent.
        """
        if self.event_bus:
            await self.event_bus.publish(
                EventCode.BROWSER_CRASH,
                task_id=active_task_id,
                payload={"reason": "Browser disconnect or crash detected"}
            )

        if not active_task_id:
            return

        task = await self.task_repo.get_by_id(active_task_id)
        if not task:
            return

        now = datetime.now(timezone.utc)
        msg_stmt = select(Message).where(Message.task_id == active_task_id)
        messages = (await self.session.execute(msg_stmt)).scalars().all()

        if task.status in {TaskStatus.SENDING.value, TaskStatus.RUNNING.value} and len(messages) > 0:
            task.status = TaskStatus.RECONCILING.value
            task.reconciliation_status = "BROWSER_CRASH_DURING_SEND"
            task.manual_review_reason = "Browser crashed during or immediately following message send."
        else:
            task.status = TaskStatus.READY.value
            task.lease_owner = None
            task.lease_expires_at = None

        task.updated_at = now
        await self.session.commit()
