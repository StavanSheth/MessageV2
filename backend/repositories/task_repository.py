from typing import List, Optional
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, update, and_, or_, func, case
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

    async def claim_next_ready(self, worker_id: str, task_types: Optional[List[str]] = None,
                               lease_duration_seconds: int = 300,
                               random_order: bool = False) -> Optional[Task]:
        """Atomically find and claim the next ready task or expired lease."""
        now = datetime.now(timezone.utc)
        type_cond = [Task.type.in_(task_types)] if task_types else []

        ready_cond = and_(
            Task.status == TaskStatus.READY.value,
            Task.scheduled_at <= now,
            *type_cond
        )
        expired_lease_cond = and_(
            Task.status == TaskStatus.RUNNING.value,
            Task.lease_expires_at != None,
            Task.lease_expires_at < now,
            *type_cond
        )

        order_by_args = [func.random()] if random_order else [Task.priority.desc(), Task.scheduled_at.asc()]

        stmt = (
            select(Task.id)
            .where(or_(ready_cond, expired_lease_cond))
            .order_by(*order_by_args)
            .limit(1)
        )
        task_id = (await self.session.execute(stmt)).scalar_one_or_none()
        if not task_id:
            return None

        expires_at = now + timedelta(seconds=lease_duration_seconds)

        update_stmt = (
            update(Task)
            .where(
                and_(
                    Task.id == task_id,
                    or_(
                        Task.status == TaskStatus.READY.value,
                        and_(Task.status == TaskStatus.RUNNING.value, Task.lease_expires_at < now)
                    )
                )
            )
            .values(
                status=TaskStatus.RUNNING.value,
                worker_id=worker_id,
                lease_owner=worker_id,
                lease_expires_at=expires_at,
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
        return None

    async def update_status(self, task_id: str, new_status: TaskStatus,
                            last_error_id: Optional[str] = None,
                            worker_id: Optional[str] = None,
                            **kwargs) -> Optional[Task]:
        task = await self.get_by_id(task_id)
        if not task:
            return None
        
        if worker_id is not None and task.lease_owner is not None and task.lease_owner != worker_id:
            raise PermissionError(f"Cannot modify task {task_id} owned by {task.lease_owner}")

        current_status = TaskStatus(task.status)
        validate_task_transition(current_status, new_status)
        
        now = datetime.now(timezone.utc)
        values = {
            "status": new_status.value,
            "updated_at": now
        }
        if new_status == TaskStatus.COMPLETED:
            values["completed_at"] = now
            values["lease_owner"] = None
            values["lease_expires_at"] = None
        elif new_status in (TaskStatus.READY, TaskStatus.PAUSED):
            values["lease_owner"] = None
            values["lease_expires_at"] = None

        if last_error_id:
            values["last_error_id"] = last_error_id
        if worker_id is not None:
            values["worker_id"] = worker_id
            values["lease_owner"] = worker_id

        for k, v in kwargs.items():
            if hasattr(Task, k):
                values[k] = v

        stmt = update(Task).where(Task.id == task_id).values(**values)
        await self.session.execute(stmt)
        await self.session.commit()
        return await self.get_by_id(task_id)

    async def list_tasks(self, status: Optional[str] = None, limit: int = 2000, offset: int = 0) -> List[Task]:
        stmt = select(Task).options(
            selectinload(Task.contact).selectinload(Contact.tasks),
            selectinload(Task.messages)
        )
        if status:
            stmt = stmt.where(Task.status == status)
            if status == TaskStatus.COMPLETED.value:
                stmt = stmt.order_by(Task.completed_at.desc(), Task.updated_at.desc())
            elif status in (TaskStatus.READY.value, TaskStatus.QUEUED.value):
                stmt = stmt.order_by(Task.priority.desc(), Task.scheduled_at.asc())
            else:
                stmt = stmt.order_by(Task.updated_at.desc(), Task.created_at.desc())
        else:
            status_rank = case(
                (Task.status == TaskStatus.RUNNING.value, 0),
                (Task.status == TaskStatus.READY.value, 1),
                (Task.status == TaskStatus.QUEUED.value, 1),
                (Task.status == TaskStatus.RETRY_WAIT.value, 2),
                (Task.status == TaskStatus.MANUAL_REVIEW.value, 3),
                (Task.status == TaskStatus.RECONCILING.value, 3),
                (Task.status == TaskStatus.COMPLETED.value, 4),
                (Task.status == TaskStatus.CANCELLED.value, 5),
                (Task.status == TaskStatus.SKIPPED.value, 6),
                else_=7
            )
            stmt = stmt.order_by(status_rank, Task.priority.desc(), Task.scheduled_at.asc(), Task.completed_at.desc(), Task.created_at.desc())

        if limit and limit > 0:
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

    async def delete(self, task_id: str) -> bool:
        from sqlalchemy import delete
        stmt = delete(Task).where(Task.id == task_id)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount > 0

    async def update_task(self, task_id: str, **kwargs) -> Optional[Task]:
        task = await self.get_by_id(task_id)
        if not task:
            return None
        now = datetime.now(timezone.utc)
        values = {"updated_at": now}
        for k, v in kwargs.items():
            if hasattr(Task, k):
                values[k] = v
        if "status" in values:
            if values["status"] in (TaskStatus.READY.value, TaskStatus.PAUSED.value):
                values["lease_owner"] = None
                values["lease_expires_at"] = None
        stmt = update(Task).where(Task.id == task_id).values(**values)
        await self.session.execute(stmt)
        await self.session.commit()
        return await self.get_by_id(task_id)

    async def approve_task(self, task_id: str, approved_by: str = "operator") -> Optional[Task]:
        return await self.update_status(
            task_id,
            TaskStatus.READY,
            manual_review_reason=f"Approved by {approved_by}"
        )

    async def reject_task(self, task_id: str, reason: str = "Rejected by operator") -> Optional[Task]:
        return await self.update_status(
            task_id,
            TaskStatus.CANCELLED,
            manual_review_reason=f"Rejected: {reason}"
        )

    async def bulk_set_selection(self, task_ids: List[str], selected: bool) -> int:
        """Bulk include (READY) or exclude/pause (PAUSED) tasks."""
        if not task_ids:
            return 0
        new_status = TaskStatus.READY.value if selected else TaskStatus.PAUSED.value
        values = {
            "status": new_status,
            "updated_at": datetime.now(timezone.utc),
            "lease_owner": None,
            "lease_expires_at": None
        }
        stmt = update(Task).where(Task.id.in_(task_ids)).values(**values)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount

    async def reorder_tasks(self, ordered_task_ids: List[str]) -> int:
        """Set decreasing priority so tasks are claimed in exact order provided."""
        if not ordered_task_ids:
            return 0
        base_priority = 10000
        count = 0
        for idx, tid in enumerate(ordered_task_ids):
            prio = max(1, base_priority - idx)
            await self.session.execute(
                update(Task)
                .where(Task.id == tid)
                .values(priority=prio, updated_at=datetime.now(timezone.utc))
            )
            count += 1
        await self.session.commit()
        return count


