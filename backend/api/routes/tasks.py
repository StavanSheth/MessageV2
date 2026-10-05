from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.session import get_db
from backend.repositories.task_repository import TaskRepository
from backend.domain.enums import TaskStatus
from backend.events.event_bus import event_bus
from backend.domain.enums import EventCode

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

from datetime import datetime, timezone
from typing import Optional

def format_datetime_readable(dt: Optional[datetime]) -> Optional[str]:
    """Format datetime into standard human readable string: Day, DD Mon YYYY, HH:MM:SS UTC."""
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%a, %d %b %Y, %H:%M:%S UTC")

@router.get("")
async def list_tasks(status: str = None, limit: int = 2000, offset: int = 0, db: AsyncSession = Depends(get_db)):
    repo = TaskRepository(db)
    tasks = await repo.list_tasks(status=status, limit=limit, offset=offset)

    def resolve_task_message(t):
        if not t.contact:
            return None
        if t.type == "FOLLOW_UP_1":
            return t.contact.followup_1_message or "Hey! Just following up on my previous message."
        elif t.type == "FOLLOW_UP_2":
            return t.contact.followup_2_message or "Hey! One final quick check-in before I close this thread."
        return t.contact.message or "Hey"

    return [{
        "id": t.id,
        "contact_id": t.contact_id,
        "contact_name": t.contact.name if t.contact else None,
        "contact_instagram": t.contact.instagram_url if t.contact else None,
        "username": t.contact.username if t.contact else None,
        "message": resolve_task_message(t),
        "type": t.type,
        "status": t.status,
        "sequence": t.sequence,
        "priority": t.priority,
        "attempt_count": t.attempt_count,
        "retry_count": t.attempt_count,
        "max_retries": 3,
        "scheduled_at": format_datetime_readable(t.scheduled_at),
        "started_at": format_datetime_readable(t.started_at),
        "completed_at": format_datetime_readable(t.completed_at),
        "worker_id": t.worker_id,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None
    } for t in tasks]

@router.post("/retry-all")
async def retry_all_tasks(db: AsyncSession = Depends(get_db)):
    repo = TaskRepository(db)
    retryable_statuses = (
        TaskStatus.FAILED.value,
        TaskStatus.MANUAL_REVIEW.value,
        TaskStatus.RETRY_WAIT.value,
        TaskStatus.INTERRUPTED.value,
        TaskStatus.SKIPPED.value,
        TaskStatus.RECONCILING.value,
    )
    all_tasks = await repo.list_tasks(limit=1000)
    retried_count = 0
    for t in all_tasks:
        if t.status in retryable_statuses:
            await repo.update_status(t.id, TaskStatus.READY)
            retried_count += 1
            await event_bus.publish(
                EventCode.TASK_RETRY_SCHEDULED,
                task_id=t.id,
                payload={"previous_status": t.status}
            )
    return {"retried_count": retried_count}

@router.post("/{task_id}/retry")
async def retry_task(task_id: str, db: AsyncSession = Depends(get_db)):
    repo = TaskRepository(db)
    task = await repo.get_by_id(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if task.status not in (TaskStatus.FAILED.value, TaskStatus.MANUAL_REVIEW.value,
                           TaskStatus.RETRY_WAIT.value, TaskStatus.INTERRUPTED.value,
                           TaskStatus.SKIPPED.value, TaskStatus.RECONCILING.value):
        raise HTTPException(400, f"Task in status '{task.status}' cannot be retried")
    await repo.update_status(task_id, TaskStatus.READY)
    await event_bus.publish(EventCode.TASK_RETRY_SCHEDULED, task_id=task_id, payload={"previous_status": task.status})
    return {"task_id": task_id, "status": "READY"}

@router.post("/{task_id}/cancel")
async def cancel_task(task_id: str, db: AsyncSession = Depends(get_db)):
    repo = TaskRepository(db)
    task = await repo.get_by_id(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if task.status in (TaskStatus.COMPLETED.value, TaskStatus.CANCELLED.value):
        raise HTTPException(400, f"Task already {task.status}")
    await repo.update_status(task_id, TaskStatus.CANCELLED)
    return {"task_id": task_id, "status": "CANCELLED"}

@router.delete("/{task_id}")
async def delete_task(task_id: str, db: AsyncSession = Depends(get_db)):
    repo = TaskRepository(db)
    task = await repo.get_by_id(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    deleted = await repo.delete(task_id)
    if not deleted:
        raise HTTPException(500, "Failed to delete task")
    return {"id": task_id, "status": "deleted"}

