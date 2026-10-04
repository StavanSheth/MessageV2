from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy import select, update, and_, func
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Task, Contact, Message, Error
from backend.domain.enums import TaskStatus, TaskType
from backend.domain.state_machine.task_machine import validate_task_transition

class TaskRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, contact_id: str, task_type: str = "MESSAGE",
                     sequence: int = 1, priority: int = 1,
                     scheduled_at: Optional[datetime] = None,
                     idempotency_key: Optional[str] = None) -> Task:
        if scheduled_at is None:
            scheduled_at = datetime.now(timezone.utc)
        
        task = Task(
            contact_id=contact_id,
            type=task_type,
            status=TaskStatus.READY.value,
            sequence=sequence,
            priority=priority,
            scheduled_at=scheduled_at,
            idempotency_key=idempotency_key
        )
        self.session.add(task)
        await self.session.flush()
        return task

    async def get_by_id(self, task_id: str) -> Optional[Task]:
        stmt = (
            select(Task)
            .options(selectinload(Task.contact), selectinload(Task.messages))
            .where(Task.id == task_id)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def claim_next_ready(self, worker_id: str, lease_duration_seconds: int = 120) -> Optional[Task]:
        """Atomically find and claim the next ready task or safely take over an expired lease."""
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=lease_duration_seconds)

        # 1. First priority: READY task scheduled <= now
        stmt = (
            select(Task.id)
            .where(
                and_(
                    Task.status == TaskStatus.READY.value,
                    Task.scheduled_at <= now
                )
            )
            .order_by(Task.priority.desc(), Task.scheduled_at.asc())
            .limit(1)
        )
        task_id = (await self.session.execute(stmt)).scalar_one_or_none()

        if task_id:
            update_stmt = (
                update(Task)
                .where(and_(Task.id == task_id, Task.status == TaskStatus.READY.value))
                .values(
                    status=TaskStatus.RUNNING.value,
                    worker_id=worker_id,
                    lease_owner=worker_id,
                    lease_expires_at=expires_at,
                    last_heartbeat=now,
                    started_at=now,
                    attempt_count=Task.attempt_count + 1,
                    updated_at=now
                )
                .returning(Task.id)
            )
            claimed_id = (await self.session.execute(update_stmt)).scalar_one_or_none()
            if claimed_id:
                await self.session.commit()
                return await self.get_by_id(claimed_id)

        # 2. Safe takeover: RUNNING task with expired lease (worker crash recovery)
        expired_stmt = (
            select(Task.id)
            .where(
                and_(
                    Task.status == TaskStatus.RUNNING.value,
                    Task.lease_expires_at < now
                )
            )
            .order_by(Task.priority.desc(), Task.scheduled_at.asc())
            .limit(1)
        )
        expired_id = (await self.session.execute(expired_stmt)).scalar_one_or_none()
        if expired_id:
            takeover_stmt = (
                update(Task)
                .where(
                    and_(
                        Task.id == expired_id,
                        Task.status == TaskStatus.RUNNING.value,
                        Task.lease_expires_at < now
                    )
                )
                .values(
                    worker_id=worker_id,
                    lease_owner=worker_id,
                    lease_expires_at=expires_at,
                    last_heartbeat=now,
                    attempt_count=Task.attempt_count + 1,
                    updated_at=now
                )
                .returning(Task.id)
            )
            claimed_id = (await self.session.execute(takeover_stmt)).scalar_one_or_none()
            if claimed_id:
                await self.session.commit()
                return await self.get_by_id(claimed_id)

        return None

    async def heartbeat(self, task_id: str, worker_id: str, extend_seconds: int = 120) -> bool:
        """Extend lease for an active task owned by worker_id."""
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=extend_seconds)
        stmt = (
            update(Task)
            .where(and_(Task.id == task_id, Task.lease_owner == worker_id))
            .values(last_heartbeat=now, lease_expires_at=expires_at, updated_at=now)
            .returning(Task.id)
        )
        res = (await self.session.execute(stmt)).scalar_one_or_none()
        if res:
            await self.session.commit()
            return True
        return False

    async def update_status(self, task_id: str, new_status: TaskStatus,
                            last_error_id: Optional[str] = None,
                            scheduled_at: Optional[datetime] = None,
                            worker_id: Optional[str] = None,
                            last_result_code: Optional[str] = None,
                            manual_review_reason: Optional[str] = None) -> Optional[Task]:
        task = await self.get_by_id(task_id)
        if not task:
            return None
        
        # Enforce worker lease check: prevent stale workers from modifying active tasks owned by another worker
        now = datetime.now(timezone.utc)
        expires_at = task.lease_expires_at
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if (
            worker_id
            and task.lease_owner
            and task.lease_owner != worker_id
            and expires_at
            and expires_at > now
        ):
            raise PermissionError(f"Cannot modify task {task_id}: actively owned by {task.lease_owner}")

        current_status = TaskStatus(task.status)
        validate_task_transition(current_status, new_status)
        
        values = {
            "status": new_status.value,
            "updated_at": now
        }
        if worker_id:
            values["worker_id"] = worker_id
            values["lease_owner"] = worker_id
            values["last_heartbeat"] = now

        if new_status == TaskStatus.READY:
            values["scheduled_at"] = scheduled_at or now
            values["worker_id"] = None
            values["lease_owner"] = None
            values["lease_expires_at"] = None
        elif new_status == TaskStatus.COMPLETED:
            values["completed_at"] = now
            values["lease_owner"] = None
            values["lease_expires_at"] = None
        elif new_status in (TaskStatus.CANCELLED, TaskStatus.SKIPPED):
            values["lease_owner"] = None
            values["lease_expires_at"] = None

        if last_error_id:
            values["last_error_id"] = last_error_id
        if last_result_code:
            values["last_result_code"] = last_result_code
        if manual_review_reason:
            values["manual_review_reason"] = manual_review_reason

        stmt = update(Task).where(Task.id == task_id).values(**values)
        await self.session.execute(stmt)
        await self.session.commit()
        return await self.get_by_id(task_id)

    async def approve_task(self, task_id: str, approved_by: str = "operator") -> Optional[Task]:
        now = datetime.now(timezone.utc)
        stmt = (
            update(Task)
            .where(and_(Task.id == task_id, Task.status == TaskStatus.AWAITING_APPROVAL.value))
            .values(
                status=TaskStatus.APPROVED.value,
                approved_at=now,
                approved_by=approved_by,
                updated_at=now
            )
            .returning(Task.id)
        )
        res = (await self.session.execute(stmt)).scalar_one_or_none()
        if res:
            await self.session.commit()
            return await self.get_by_id(task_id)
        return None

    async def reject_task(self, task_id: str, reason: str = "Rejected by operator") -> Optional[Task]:
        now = datetime.now(timezone.utc)
        stmt = (
            update(Task)
            .where(and_(Task.id == task_id, Task.status == TaskStatus.AWAITING_APPROVAL.value))
            .values(
                status=TaskStatus.SKIPPED.value,
                manual_review_reason=reason,
                updated_at=now
            )
            .returning(Task.id)
        )
        res = (await self.session.execute(stmt)).scalar_one_or_none()
        if res:
            await self.session.commit()
            return await self.get_by_id(task_id)
        return None

    async def list_tasks(self, status: Optional[str] = None, limit: int = 100, offset: int = 0) -> List[Task]:
        stmt = select(Task).options(selectinload(Task.contact)).order_by(Task.created_at.desc())
        if status:
            stmt = stmt.where(Task.status == status)
        stmt = stmt.limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_interrupted(self) -> List[Task]:
        stmt = (
            select(Task)
            .options(selectinload(Task.contact))
            .where(Task.status == TaskStatus.RUNNING.value)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_by_status(self) -> dict:
        stmt = select(Task.status, func.count(Task.id)).group_by(Task.status)
        result = await self.session.execute(stmt)
        return {status: count for status, count in result.all()}
