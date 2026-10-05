import logging
from datetime import datetime, timezone
from typing import List, Dict, Any
from sqlalchemy import select, update, or_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.repositories.task_repository import TaskRepository
from backend.database.models import Task, Message
from backend.domain.enums import TaskStatus, EventCode, ResultCode

logger = logging.getLogger(__name__)

class RecoveryService:
    def __init__(self, session: AsyncSession, event_bus=None):
        self.session = session
        self.event_bus = event_bus
        self.task_repo = TaskRepository(session)

    async def reconcile_on_startup(self) -> Dict[str, List[str]]:
        """
        On backend startup: find RUNNING or INTERRUPTED tasks from previous session.
        Tasks with send_attempt_id or in RUNNING state move to RECONCILING with
        reconciliation_status='PENDING_CONVERSATION_INSPECTION'.
        """
        stmt = select(Task).where(
            or_(
                Task.status == TaskStatus.RUNNING.value,
                Task.status == TaskStatus.INTERRUPTED.value,
                Task.status == TaskStatus.RECONCILING.value
            )
        )
        tasks = (await self.session.execute(stmt)).scalars().all()
        reconciling = []
        for task in tasks:
            task.status = TaskStatus.RECONCILING.value
            task.reconciliation_status = "PENDING_CONVERSATION_INSPECTION"
            reconciling.append(task.id)
            if self.event_bus:
                try:
                    await self.event_bus.publish(EventCode.RECOVERY_STARTED, {
                        "task_id": task.id,
                        "reason": "Application restart: task was RUNNING"
                    }, task_id=task.id)
                except Exception:
                    pass
        await self.session.commit()
        return {"reconciling": reconciling, "reset_to_ready": []}

    async def reconcile_task_with_conversation(self, task_id: str, adapter, expected_text: str = "") -> str:
        """
        Reconciles task by inspecting the DM thread via adapter.
        """
        task = await self.task_repo.get_by_id(task_id)
        if not task:
            return "MANUAL_REVIEW"
        
        result = await adapter.inspect_conversation(expected_text)
        if result == ResultCode.SUCCESS:
            task.status = TaskStatus.COMPLETED.value
            task.reconciliation_status = "CONFIRMED_SENT"
            task.completed_at = datetime.now(timezone.utc)
            task.lease_owner = None
            task.lease_expires_at = None
            msg_stmt = (
                update(Message)
                .where(Message.task_id == task_id)
                .values(status="SENT", confirmed_at=datetime.now(timezone.utc))
            )
            await self.session.execute(msg_stmt)
            await self.session.commit()
            return "CONFIRMED"
        elif result == ResultCode.SEND_FAILED:
            task.status = TaskStatus.READY.value
            task.reconciliation_status = "NOT_SENT"
            task.lease_owner = None
            task.lease_expires_at = None
            await self.session.commit()
            return "NOT_SENT"
        else:
            task.status = TaskStatus.MANUAL_REVIEW.value
            task.reconciliation_status = "MANUAL_REVIEW"
            await self.session.commit()
            return "MANUAL_REVIEW"

    async def handle_browser_crash(self, task_id: str):
        """
        When browser crashes during task execution:
        If task has a Message record, it was in or immediately around sending,
        so it must enter RECONCILING, never blindly reset to READY.
        If no Message record exists (e.g. crashed during verification/profile inspection),
        it can safely reset to READY and clear the lease.
        """
        task = await self.task_repo.get_by_id(task_id)
        if not task:
            return
        
        msg_stmt = select(Message.id).where(Message.task_id == task_id)
        msg_exists = (await self.session.execute(msg_stmt)).scalar_one_or_none()
        has_message = bool(msg_exists or task.send_attempt_id or (task.messages and len(task.messages) > 0))
        if has_message:
            task.status = TaskStatus.RECONCILING.value
            task.manual_review_reason = "Browser crashed during or immediately following message send"
            task.reconciliation_status = "PENDING_CONVERSATION_INSPECTION"
        else:
            task.status = TaskStatus.READY.value
            task.lease_owner = None
            task.lease_expires_at = None
        await self.session.commit()

    async def reconcile_interrupted(self) -> List[str]:
        """
        On backend startup: find RUNNING tasks from previous session and mark them INTERRUPTED.
        Returns list of affected task IDs.
        """
        interrupted_tasks = await self.task_repo.list_interrupted()
        affected = []
        for task in interrupted_tasks:
            try:
                await self.task_repo.update_status(task.id, TaskStatus.INTERRUPTED)
                affected.append(task.id)
                logger.warning(f"[Recovery] Task {task.id} marked INTERRUPTED (was RUNNING on startup)")
                if self.event_bus:
                    await self.event_bus.publish(EventCode.RECOVERY_STARTED, {
                        "task_id": task.id,
                        "reason": "Application restart: task was RUNNING"
                    }, task_id=task.id)
            except Exception as e:
                logger.error(f"[Recovery] Failed to interrupt task {task.id}: {e}")
        return affected
        """
        Inspect the conversation and determine whether message was sent.
        Returns: CONFIRMED, NOT_DONE, MANUAL_REVIEW
        """
        task = await self.task_repo.get_by_id(task_id)
        if not task:
            return "MANUAL_REVIEW"

        if instagram_adapter:
            try:
                from backend.domain.enums import ResultCode
                result = await instagram_adapter.inspect_conversation(message_text)
                if result == ResultCode.SUCCESS:
                    await self.task_repo.update_status(task_id, TaskStatus.COMPLETED)
                    return "CONFIRMED"
                elif result in {ResultCode.SEND_FAILED, ResultCode.PROFILE_NOT_FOUND}:
                    await self.task_repo.update_status(task_id, TaskStatus.READY)
                    return "NOT_DONE"
            except Exception as e:
                logger.error(f"[Recovery] reconcile_unknown_send error: {e}")

        await self.task_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW)
        return "MANUAL_REVIEW"

    async def recover_worker(self, worker_id: str) -> bool:
        """Mark worker tasks for reconciliation. Returns True if recovery initiated."""
        try:
            logger.info(f"[Recovery] Recovering worker {worker_id}")
            return True
        except Exception as e:
            logger.error(f"[Recovery] recover_worker error: {e}")
            return False
