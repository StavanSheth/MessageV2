from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.session import get_db
from backend.repositories.task_repository import TaskRepository
from backend.domain.enums import TaskStatus
from backend.events.event_bus import event_bus
from backend.domain.enums import EventCode

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

@router.get("")
async def list_tasks(status: str = None, limit: int = 100, offset: int = 0, db: AsyncSession = Depends(get_db)):
    repo = TaskRepository(db)
    tasks = await repo.list_tasks(status=status, limit=limit, offset=offset)
    return [{
        "id": t.id,
        "contact_id": t.contact_id,
        "contact_name": t.contact.name if t.contact else None,
        "contact_instagram": t.contact.instagram_url if t.contact else None,
        "type": t.type,
        "status": t.status,
        "sequence": t.sequence,
        "priority": t.priority,
        "scheduled_at": t.scheduled_at,
        "started_at": t.started_at,
        "completed_at": t.completed_at,
        "attempt_count": t.attempt_count,
        "worker_id": t.worker_id,
        "created_at": t.created_at,
        "updated_at": t.updated_at
    } for t in tasks]

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
