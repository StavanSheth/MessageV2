from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.session import get_db
from backend.repositories.task_repository import TaskRepository
from backend.domain.enums import TaskStatus
from backend.events.event_bus import event_bus
from backend.domain.enums import EventCode
from starlette.responses import StreamingResponse
from backend.services.export_service import ExportService

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

    def parse_error_info(t):
        reason = t.manual_review_reason or ""
        cat = None
        msg = reason
        if reason.startswith("[") and "]" in reason:
            parts = reason[1:].split("]", 1)
            cat = parts[0].strip()
            msg = parts[1].strip() if len(parts) > 1 else ""
        return cat, msg, reason

    def resolve_contact_dict(c):
        if not c:
            return None
        c_tasks = getattr(c, "tasks", []) or []
        t_msg = next((tk for tk in c_tasks if tk.type == "MESSAGE"), None)
        t_fu1 = next((tk for tk in c_tasks if tk.type == "FOLLOW_UP_1"), None)
        t_fu2 = next((tk for tk in c_tasks if tk.type == "FOLLOW_UP_2"), None)
        return {
            "id": c.id,
            "name": c.name,
            "username": c.username or "",
            "instagram_url": c.instagram_url,
            "message": c.message,
            "followup_1_message": c.followup_1_message,
            "followup_1_delay_days": c.followup_1_delay_days,
            "followup_1_scheduled_at": t_fu1.scheduled_at.isoformat() if (t_fu1 and t_fu1.scheduled_at) else None,
            "followup_1_status": t_fu1.status if t_fu1 else "NOT_SCHEDULED",
            "followup_2_message": c.followup_2_message,
            "followup_2_delay_days": c.followup_2_delay_days,
            "followup_2_scheduled_at": t_fu2.scheduled_at.isoformat() if (t_fu2 and t_fu2.scheduled_at) else None,
            "followup_2_status": t_fu2.status if t_fu2 else "NOT_SCHEDULED",
            "first_message_scheduled_at": t_msg.scheduled_at.isoformat() if (t_msg and t_msg.scheduled_at) else None,
            "first_message_status": t_msg.status if t_msg else "NOT_QUEUED",
            "has_replied": getattr(c, "has_replied", False) or (c.replied_status == "YES"),
            "replied_status": c.replied_status,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }

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
        "run_id": t.run_id,
        "attempt_count": t.attempt_count,
        "retry_count": t.attempt_count,
        "max_retries": 3,
        "manual_review_reason": t.manual_review_reason,
        "error_category": parse_error_info(t)[0],
        "error_message": parse_error_info(t)[1],
        "replied_status": t.contact.replied_status if t.contact else None,
        "scheduled_at": format_datetime_readable(t.scheduled_at),
        "scheduled_at_raw": t.scheduled_at.isoformat() if t.scheduled_at else None,
        "started_at": format_datetime_readable(t.started_at),
        "started_at_raw": t.started_at.isoformat() if t.started_at else None,
        "completed_at": format_datetime_readable(t.completed_at),
        "completed_at_raw": t.completed_at.isoformat() if t.completed_at else None,
        "worker_id": t.worker_id,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
        "contact": resolve_contact_dict(t.contact)
    } for t in tasks]

@router.get("/export/excel")
async def export_queue_excel(db: AsyncSession = Depends(get_db)):
    """Export complete queue categorized into 4 sheets (Upcoming, Done, Action Needed, All) to Excel (.xlsx)."""
    excel_stream = await ExportService.generate_queue_excel(db)
    filename = f"Dispatch_Queue_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        excel_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Expose-Headers": "Content-Disposition",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )

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

from pydantic import BaseModel
from typing import List, Optional

class UpdateTaskRequest(BaseModel):
    status: Optional[str] = None
    scheduled_at: Optional[str] = None
    priority: Optional[int] = None
    message: Optional[str] = None

@router.put("/{task_id}")
async def update_task_details(task_id: str, req: UpdateTaskRequest, db: AsyncSession = Depends(get_db)):
    """Update task schedule, priority, status, and associated sequence message."""
    from dateutil import parser as dt_parser
    repo = TaskRepository(db)
    task = await repo.get_by_id(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    kwargs = {}
    if req.status:
        st_upper = req.status.upper()
        if st_upper in ("SCHEDULED", "READY"):
            kwargs["status"] = TaskStatus.READY.value
        elif st_upper in ("PAUSED", "CANCELLED", "COMPLETED", "MANUAL_REVIEW", "QUEUED"):
            kwargs["status"] = st_upper
        else:
            kwargs["status"] = st_upper

    if req.scheduled_at:
        try:
            dt = dt_parser.parse(req.scheduled_at)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            kwargs["scheduled_at"] = dt
        except Exception:
            raise HTTPException(400, "Invalid date format for scheduled_at")

    if req.priority is not None:
        kwargs["priority"] = req.priority

    updated_task = await repo.update_task(task_id, **kwargs)

    # Sync message if provided
    if req.message is not None and updated_task:
        if updated_task.messages:
            updated_task.messages[0].body = req.message
            await db.commit()
        if updated_task.contact:
            if updated_task.type == "FOLLOW_UP_1":
                updated_task.contact.followup_1_message = req.message
            elif updated_task.type == "FOLLOW_UP_2":
                updated_task.contact.followup_2_message = req.message
            else:
                updated_task.contact.message = req.message
            await db.commit()

    return {
        "status": "success",
        "task_id": task_id,
        "updated_status": updated_task.status if updated_task else None,
        "scheduled_at": format_datetime_readable(updated_task.scheduled_at) if updated_task else None
    }

@router.post("/{task_id}/toggle-pause")
async def toggle_task_pause(task_id: str, db: AsyncSession = Depends(get_db)):
    """Pause or resume a task."""
    repo = TaskRepository(db)
    task = await repo.get_by_id(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    
    new_status = TaskStatus.READY.value if task.status == TaskStatus.PAUSED.value else TaskStatus.PAUSED.value
    updated = await repo.update_task(task_id, status=new_status)
    return {"task_id": task_id, "status": updated.status if updated else new_status}

class BulkSelectionRequest(BaseModel):
    task_ids: List[str]
    selected: bool

@router.post("/bulk-selection")
async def bulk_task_selection(req: BulkSelectionRequest, db: AsyncSession = Depends(get_db)):
    """Bulk include (READY) or exclude/pause (PAUSED) tasks for workers."""
    repo = TaskRepository(db)
    count = await repo.bulk_set_selection(req.task_ids, req.selected)
    status_str = "READY" if req.selected else "PAUSED"
    return {"status": "ok", "updated_count": count, "new_status": status_str}

class ReorderTasksRequest(BaseModel):
    task_ids: List[str]

@router.post("/reorder")
async def reorder_tasks(req: ReorderTasksRequest, db: AsyncSession = Depends(get_db)):
    """Reorder tasks in custom order by setting priorities accordingly."""
    repo = TaskRepository(db)
    count = await repo.reorder_tasks(req.task_ids)
    return {"status": "ok", "reordered_count": count}

class FollowUpReviewRequest(BaseModel):
    task_ids: Optional[List[str]] = None
    contact_ids: Optional[List[str]] = None

@router.post("/confirm-followups")
async def confirm_followups(req: FollowUpReviewRequest, db: AsyncSession = Depends(get_db)):
    """Approve and re-queue follow-up tasks for replied contacts or tasks in review."""
    from backend.database.models import Task
    from sqlalchemy import select, and_, or_
    conds = []
    if req.task_ids:
        conds.append(Task.id.in_(req.task_ids))
    if req.contact_ids:
        conds.append(Task.contact_id.in_(req.contact_ids))
    
    if conds:
        stmt = select(Task).where(or_(*conds))
    else:
        # If no specific IDs provided, approve all tasks waiting in MANUAL_REVIEW with REPLY_RECEIVED or AWAITING_APPROVAL
        stmt = select(Task).where(
            or_(
                and_(Task.status == TaskStatus.MANUAL_REVIEW.value, Task.manual_review_reason.like("%REPLY_RECEIVED%")),
                Task.status == TaskStatus.AWAITING_APPROVAL.value
            )
        )
    
    tasks = (await db.execute(stmt)).scalars().all()
    repo = TaskRepository(db)
    confirmed_count = 0
    now = datetime.now(timezone.utc)
    for t in tasks:
        await repo.update_status(t.id, TaskStatus.READY, manual_review_reason=f"Approved by user for dispatch at {now.strftime('%b %d, %H:%M')}")
        confirmed_count += 1
    
    return {"status": "ok", "updated_count": confirmed_count, "confirmed_count": confirmed_count}

@router.post("/cancel-followups")
async def cancel_followups(req: FollowUpReviewRequest, db: AsyncSession = Depends(get_db)):
    """Cancel follow-up tasks for replied contacts or rejected review tasks so no message is sent."""
    from backend.database.models import Task
    from sqlalchemy import select, and_, or_
    conds = []
    if req.task_ids:
        conds.append(Task.id.in_(req.task_ids))
    if req.contact_ids:
        conds.append(Task.contact_id.in_(req.contact_ids))
    
    if conds:
        stmt = select(Task).where(or_(*conds))
    else:
        stmt = select(Task).where(
            and_(
                Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]),
                Task.status == TaskStatus.MANUAL_REVIEW.value,
                Task.manual_review_reason.like("%REPLY_RECEIVED%")
            )
        )
    
    tasks = (await db.execute(stmt)).scalars().all()
    repo = TaskRepository(db)
    cancelled_count = 0
    for t in tasks:
        await repo.update_status(t.id, TaskStatus.CANCELLED, manual_review_reason="Cancelled by user review")
        cancelled_count += 1
    
    return {"status": "ok", "cancelled_count": cancelled_count}


