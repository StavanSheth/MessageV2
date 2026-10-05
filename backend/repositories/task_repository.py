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
                     scheduled_at: Optional[datetime] = None) -> Task:
        if scheduled_at is None:
            scheduled_at = datetime.now(timezone.utc)
        
        task = Task(
            contact_id=contact_id,
            type=task_type,
            status=TaskStatus.READY.value,
            sequence=sequence,
            priority=priority,
            scheduled_at=scheduled_at
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

    async def claim_next_ready(self, worker_id: str) -> Optional[Task]:
        """Atomically find and claim the next ready task."""
        now = datetime.now(timezone.utc)
        # Select first ready task ordered by priority desc, scheduled_at asc
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
        if not task_id:
            return None

        # Atomically update status from READY to RUNNING
        update_stmt = (
            update(Task)
            .where(and_(Task.id == task_id, Task.status == TaskStatus.READY.value))
            .values(
                status=TaskStatus.RUNNING.value,
                worker_id=worker_id,
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
        
        current_status = TaskStatus(task.status)
        validate_task_transition(current_status, new_status)
        
        now = datetime.now(timezone.utc)
        values = {
            "status": new_status.value,
            "updated_at": now
        }
        if new_status == TaskStatus.COMPLETED:
            values["completed_at"] = now
        if last_error_id:
            values["last_error_id"] = last_error_id
        if "worker_id" in kwargs or worker_id is not None or "worker_id" in values:
            values["worker_id"] = worker_id

        stmt = update(Task).where(Task.id == task_id).values(**values)
        await self.session.execute(stmt)
        await self.session.commit()
        return await self.get_by_id(task_id)

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

    async def delete(self, task_id: str) -> bool:
        from sqlalchemy import delete
        stmt = delete(Task).where(Task.id == task_id)
        result = await self.session.execute(stmt)
        await self.session.commit()
        return result.rowcount > 0

