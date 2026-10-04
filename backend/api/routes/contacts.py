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
    apply_to_all: bool = False

@router.get("")
async def list_contacts(limit: int = 1000, offset: int = 0, db: AsyncSession = Depends(get_db)):
    repo = ContactRepository(db)
    contacts = await repo.list_with_tracking(limit=limit, offset=offset)
    result = []
    
    for c in contacts:
        task_msg = next((t for t in c.tasks if t.type == "MESSAGE"), None)
        task_fu1 = next((t for t in c.tasks if t.type == "FOLLOW_UP_1"), None)
        task_fu2 = next((t for t in c.tasks if t.type == "FOLLOW_UP_2"), None)

        m1 = next((m for m in reversed(task_msg.messages) if m.status == "SENT"), task_msg.messages[-1] if task_msg.messages else None) if (task_msg and task_msg.messages) else None
        m_fu1 = next((m for m in reversed(task_fu1.messages) if m.status == "SENT"), task_fu1.messages[-1] if task_fu1.messages else None) if (task_fu1 and task_fu1.messages) else None
        m_fu2 = next((m for m in reversed(task_fu2.messages) if m.status == "SENT"), task_fu2.messages[-1] if task_fu2.messages else None) if (task_fu2 and task_fu2.messages) else None

        # 1st Message details
        m1_status = "NOT_QUEUED"
        m1_sent_at = None
        if task_msg:
            m1_status = task_msg.status
            if task_msg.status == "COMPLETED" or (m1 and m1.status == "SENT"):
                m1_status = "SENT"
                m1_sent_at = format_datetime_readable((m1.confirmed_at if m1 else None) or task_msg.completed_at)

        # Follow Up 1 details
        fu1_status = "NOT_SCHEDULED"
        fu1_scheduled_at = None
        fu1_sent_at = None
        if task_fu1:
            fu1_status = task_fu1.status
            fu1_scheduled_at = format_datetime_readable(task_fu1.scheduled_at)
            if task_fu1.status == "COMPLETED" or (m_fu1 and m_fu1.status == "SENT"):
                fu1_status = "SENT"
                fu1_sent_at = format_datetime_readable((m_fu1.confirmed_at if m_fu1 else None) or task_fu1.completed_at)
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
                fu2_sent_at = format_datetime_readable((m_fu2.confirmed_at if m_fu2 else None) or task_fu2.completed_at)
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
            "expected_followers": c.expected_followers,
            "verification_status": "VERIFIED" if (task_msg and task_msg.status == "COMPLETED") else "PENDING",
            "has_replied": c.replied_status == "YES",
            "replied_status": c.replied_status,
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
        "followup_2_message": "Hey! One final quick check-in — let me know if you'd like more details."
    }

@router.post("/templates/apply")
async def apply_bulk_templates(req: BulkTemplateRequest, db: AsyncSession = Depends(get_db)):
    """Apply updated outreach message templates across contacts."""
    repo = ContactRepository(db)
    updated_count = await repo.update_bulk_templates(
        default_message=req.default_message,
        followup_1_message=req.followup_1_message,
        followup_2_message=req.followup_2_message,
        apply_to_all=req.apply_to_all
    )
    return {
        "status": "success",
        "updated_contacts_count": updated_count,
        "message": f"Successfully updated outreach message templates for {updated_count} contacts"
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
