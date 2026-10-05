from typing import Optional, List
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.session import get_db
from backend.repositories.contact_repository import ContactRepository
from backend.services.export_service import ExportService
from backend.config.settings import settings

router = APIRouter(prefix="/api/contacts", tags=["contacts"])

def format_datetime_readable(dt: Optional[datetime]) -> Optional[str]:
    """Format datetime into standard human readable string: Day, DD Mon YYYY, HH:MM:SS UTC."""
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%a, %d %b %Y, %H:%M:%S UTC")

class UpdateMessagesRequest(BaseModel):
    message: Optional[str] = None
    followup_1_message: Optional[str] = None
    followup_2_message: Optional[str] = None

class BulkTemplateRequest(BaseModel):
    default_message: Optional[str] = None
    followup_1_message: Optional[str] = None
    followup_2_message: Optional[str] = None
    followup_1_delay_days: Optional[int] = None
    followup_2_delay_days: Optional[int] = None
    apply_to_all: bool = False
    reschedule_existing: bool = False

class FollowupScheduleRequest(BaseModel):
    followup_1_scheduled_at: Optional[str] = None
    followup_1_status: Optional[str] = None
    followup_1_delay_days: Optional[int] = None
    followup_2_scheduled_at: Optional[str] = None
    followup_2_status: Optional[str] = None
    followup_2_delay_days: Optional[int] = None

@router.get("")
async def list_contacts(limit: int = 1000, offset: int = 0, db: AsyncSession = Depends(get_db)):
    repo = ContactRepository(db)
    contacts = await repo.list_with_tracking(limit=limit, offset=offset)
    result = []
    
    for c in contacts:
        task_msg = next((t for t in c.tasks if t.type == "MESSAGE"), None)
        task_fu1 = next((t for t in c.tasks if t.type == "FOLLOW_UP_1"), None)
        task_fu2 = next((t for t in c.tasks if t.type == "FOLLOW_UP_2"), None)

        m1 = task_msg.messages[0] if (task_msg and task_msg.messages) else None
        m_fu1 = task_fu1.messages[0] if (task_fu1 and task_fu1.messages) else None
        m_fu2 = task_fu2.messages[0] if (task_fu2 and task_fu2.messages) else None

        # 1st Message details
        m1_status = "NOT_QUEUED"
        m1_sent_at = None
        if task_msg:
            m1_status = task_msg.status
            if task_msg.status == "COMPLETED" or (m1 and m1.status == "SENT"):
                m1_status = "SENT"
                m1_sent_at = format_datetime_readable(m1.confirmed_at if m1 else task_msg.completed_at)

        # Follow Up 1 details
        fu1_status = "NOT_SCHEDULED"
        fu1_scheduled_at = None
        fu1_sent_at = None
        if task_fu1:
            fu1_status = task_fu1.status
            fu1_scheduled_at = format_datetime_readable(task_fu1.scheduled_at)
            if task_fu1.status == "COMPLETED" or (m_fu1 and m_fu1.status == "SENT"):
                fu1_status = "SENT"
                fu1_sent_at = format_datetime_readable(m_fu1.confirmed_at if m_fu1 else task_fu1.completed_at)
            elif task_fu1.status == "READY":
                fu1_status = "SCHEDULED"

        # Follow Up 2 details
        fu2_status = "NOT_SCHEDULED"
        fu2_scheduled_at = None
        fu2_sent_at = None
        if task_fu2:
            fu2_status = task_fu2.status
            fu2_scheduled_at = format_datetime_readable(task_fu2.scheduled_at)
            if task_fu2.status == "COMPLETED" or (m_fu2 and m_fu2.status == "SENT"):
                fu2_status = "SENT"
                fu2_sent_at = format_datetime_readable(m_fu2.confirmed_at if m_fu2 else task_fu2.completed_at)
            elif task_fu2.status == "READY":
                fu2_status = "SCHEDULED"

        result.append({
            "id": c.id,
            "name": c.name,
            "instagram_url": c.instagram_url,
            "username": c.username,
            "message": c.message or settings.DEFAULT_MESSAGE,
            "custom_message": c.message,
            "followup_1_message": c.followup_1_message or "Hey! Just wanted to follow up on my previous message.",
            "followup_2_message": c.followup_2_message or "Hey! One last quick check-in before I close this thread.",
            "followup_1_delay_days": c.followup_1_delay_days or 3,
            "followup_2_delay_days": c.followup_2_delay_days or 5,
            "expected_followers": c.expected_followers,
            "verification_status": "VERIFIED" if (task_msg and task_msg.status == "COMPLETED") else "PENDING",
            "has_replied": c.replied_status == "YES",
            "replied_status": c.replied_status,
            "auto_reply_message": c.auto_reply_message,
            "extracted_phone": c.extracted_phone,
            "extracted_email": c.extracted_email,
            "extracted_link": c.extracted_link,
            "last_checked_reply_at": format_datetime_readable(c.last_checked_reply_at),
            "reply_detected_at": format_datetime_readable(c.reply_detected_at),
            "notes": c.notes,
            # 1st Message tracking
            "first_message_status": m1_status,
            "first_message_sent_at": m1_sent_at,
            # Follow Up 1 tracking
            "followup_1_status": fu1_status,
            "followup_1_scheduled_at": fu1_scheduled_at,
            "followup_1_sent_at": fu1_sent_at,
            # Follow Up 2 tracking
            "followup_2_status": fu2_status,
            "followup_2_scheduled_at": fu2_scheduled_at,
            "followup_2_sent_at": fu2_sent_at,
            # Timestamps
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "updated_at": c.updated_at.isoformat() if c.updated_at else None
        })
    return result

@router.get("/templates")
async def get_message_templates():
    """Return default message templates for outreach."""
    return {
        "default_message": settings.DEFAULT_MESSAGE,
        "followup_1_message": "Hey! Just following up on my previous message — would love to connect!",
        "followup_2_message": "Hey! One final quick check-in — let me know if you'd like more details.",
        "followup_1_delay_days": 3,
        "followup_2_delay_days": 5
    }

@router.post("/templates/apply")
async def apply_bulk_templates(req: BulkTemplateRequest, db: AsyncSession = Depends(get_db)):
    """Apply updated outreach message templates and follow-up intervals across contacts."""
    repo = ContactRepository(db)
    res = await repo.update_bulk_templates(
        default_message=req.default_message,
        followup_1_message=req.followup_1_message,
        followup_2_message=req.followup_2_message,
        followup_1_delay_days=req.followup_1_delay_days,
        followup_2_delay_days=req.followup_2_delay_days,
        apply_to_all=req.apply_to_all,
        reschedule_existing=req.reschedule_existing
    )
    return {
        "status": "success",
        "updated_contacts_count": res["updated_contacts_count"],
        "rescheduled_tasks_count": res["rescheduled_tasks_count"],
        "message": f"Updated {res['updated_contacts_count']} contacts and rescheduled {res['rescheduled_tasks_count']} pending follow-ups."
    }

@router.put("/{contact_id}/followup_schedule")
async def update_contact_followup_schedule(contact_id: str, req: FollowupScheduleRequest, db: AsyncSession = Depends(get_db)):
    """Customize follow-up schedule (dates, status, and interval delays) for an individual contact."""
    from dateutil import parser as dt_parser
    repo = ContactRepository(db)

    fu1_dt = None
    if req.followup_1_scheduled_at:
        try:
            fu1_dt = dt_parser.parse(req.followup_1_scheduled_at)
            if fu1_dt.tzinfo is None:
                fu1_dt = fu1_dt.replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "Invalid date format for followup_1_scheduled_at")

    fu2_dt = None
    if req.followup_2_scheduled_at:
        try:
            fu2_dt = dt_parser.parse(req.followup_2_scheduled_at)
            if fu2_dt.tzinfo is None:
                fu2_dt = fu2_dt.replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(400, "Invalid date format for followup_2_scheduled_at")

    contact = await repo.update_followup_schedule(
        contact_id=contact_id,
        followup_1_scheduled_at=fu1_dt,
        followup_1_status=req.followup_1_status,
        followup_1_delay_days=req.followup_1_delay_days,
        followup_2_scheduled_at=fu2_dt,
        followup_2_status=req.followup_2_status,
        followup_2_delay_days=req.followup_2_delay_days
    )
    if not contact:
        raise HTTPException(404, "Contact not found")

    return {
        "status": "success",
        "contact_id": contact_id,
        "followup_1_delay_days": contact.followup_1_delay_days,
        "followup_2_delay_days": contact.followup_2_delay_days
    }

@router.put("/{contact_id}/messages")
async def update_contact_messages(contact_id: str, req: UpdateMessagesRequest, db: AsyncSession = Depends(get_db)):
    """Update custom 1st message, Follow Up 1, and Follow Up 2 messages for an individual contact."""
    repo = ContactRepository(db)
    updated = await repo.update_messages(
        contact_id=contact_id,
        message=req.message,
        followup_1_message=req.followup_1_message,
        followup_2_message=req.followup_2_message
    )
    if not updated:
        raise HTTPException(404, "Contact not found")
    return {
        "id": updated.id,
        "message": updated.message,
        "followup_1_message": updated.followup_1_message,
        "followup_2_message": updated.followup_2_message,
        "status": "updated"
    }

@router.patch("/{contact_id}/replied")
async def update_replied(contact_id: str, status: str, db: AsyncSession = Depends(get_db)):
    if status not in ("YES", "NO", "UNKNOWN"):
        raise HTTPException(400, "status must be YES, NO, or UNKNOWN")
    repo = ContactRepository(db)
    updated = await repo.update_replied(contact_id, status)
    if not updated:
        raise HTTPException(404, "Contact not found")
    return {"id": contact_id, "replied_status": status}

@router.get("/export/excel")
async def export_contacts_excel(db: AsyncSession = Depends(get_db)):
    """Export all contacts with full 1st message, follow-up 1, and follow-up 2 tracking to Excel (.xlsx)."""
    excel_stream = await ExportService.generate_outreach_excel(db)
    filename = f"Instagram_Outreach_Tracking_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        excel_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )

@router.get("/{contact_id}")
async def get_contact(contact_id: str, db: AsyncSession = Depends(get_db)):
    repo = ContactRepository(db)
    contact = await repo.get_by_id(contact_id)
    if not contact:
        raise HTTPException(404, "Contact not found")
    return {
        "id": contact.id,
        "name": contact.name,
        "instagram_url": contact.instagram_url,
        "username": contact.username,
        "message": contact.message,
        "followup_1_message": contact.followup_1_message,
        "followup_2_message": contact.followup_2_message,
        "expected_followers": contact.expected_followers,
        "replied_status": contact.replied_status,
        "notes": contact.notes,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at
    }

class UpdateContactDetailsRequest(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    instagram_url: Optional[str] = None
    notes: Optional[str] = None
    expected_followers: Optional[int] = None

class BulkDeleteRequest(BaseModel):
    contact_ids: List[str]

class ClearContactsRequest(BaseModel):
    confirm: bool = False

@router.delete("/{contact_id}")
async def delete_contact(contact_id: str, db: AsyncSession = Depends(get_db)):
    repo = ContactRepository(db)
    contact = await repo.get_by_id(contact_id)
    if not contact:
        raise HTTPException(404, "Contact not found")
    
    deleted = await repo.delete(contact_id)
    if not deleted:
        raise HTTPException(500, "Failed to delete contact")
    return {"id": contact_id, "status": "deleted"}

@router.patch("/{contact_id}")
@router.put("/{contact_id}")
async def update_contact_details(contact_id: str, req: UpdateContactDetailsRequest, db: AsyncSession = Depends(get_db)):
    """Update contact identity details (name, username, URL, notes, expected followers)."""
    repo = ContactRepository(db)
    updated = await repo.update_contact_details(
        contact_id=contact_id,
        name=req.name,
        username=req.username,
        instagram_url=req.instagram_url,
        notes=req.notes,
        expected_followers=req.expected_followers
    )
    if not updated:
        raise HTTPException(404, "Contact not found")
    return {
        "id": updated.id,
        "name": updated.name,
        "username": updated.username,
        "instagram_url": updated.instagram_url,
        "notes": updated.notes,
        "expected_followers": updated.expected_followers,
        "status": "updated"
    }

@router.post("/bulk_delete")
async def bulk_delete_contacts(req: BulkDeleteRequest, db: AsyncSession = Depends(get_db)):
    """Delete multiple contacts and their associated tasks/messages in bulk."""
    repo = ContactRepository(db)
    deleted_count = await repo.bulk_delete(req.contact_ids)
    return {
        "status": "success",
        "deleted_count": deleted_count,
        "message": f"Successfully deleted {deleted_count} contact(s)."
    }

@router.post("/clear")
async def clear_all_contacts(req: ClearContactsRequest, db: AsyncSession = Depends(get_db)):
    """Clear all contacts, tasks, and messages from the database."""
    if not req.confirm:
        raise HTTPException(400, "Must set confirm=True to clear all contacts.")
    repo = ContactRepository(db)
    cleared_count = await repo.clear_all()
    return {
        "status": "success",
        "cleared_count": cleared_count,
        "message": f"Successfully cleared {cleared_count} contact(s) and reset the queue."
    }

class BulkRepliedRequest(BaseModel):
    status: str
    contact_ids: Optional[List[str]] = None

@router.post("/bulk_replied")
async def bulk_update_replied(req: BulkRepliedRequest, db: AsyncSession = Depends(get_db)):
    """Bulk update replied status across contacts, reviving follow-ups if reset to NO or UNKNOWN."""
    if req.status not in ("YES", "NO", "UNKNOWN"):
        raise HTTPException(400, "status must be YES, NO, or UNKNOWN")
    repo = ContactRepository(db)
    updated_count = await repo.bulk_update_replied(req.status, req.contact_ids)
    return {
        "status": "success",
        "updated_count": updated_count,
        "replied_status": req.status,
        "message": f"Updated replied status to {req.status} for {updated_count} contact(s)."
    }


