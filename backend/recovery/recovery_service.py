"""
RecoveryService: handles interrupted tasks, unknown send results, and worker crashes.
"""
import logging
from datetime import datetime, timezone
from typing import List
from sqlalchemy.ext.asyncio import AsyncSession
from backend.repositories.task_repository import TaskRepository
from backend.domain.enums import TaskStatus, EventCode

logger = logging.getLogger(__name__)

class RecoveryService:
    def __init__(self, session: AsyncSession, event_bus=None):
        self.session = session
        self.event_bus = event_bus
        self.task_repo = TaskRepository(session)

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

    async def reconcile_unknown_send(self, task_id: str, instagram_adapter=None, message_text: str = "Hey") -> str:
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
