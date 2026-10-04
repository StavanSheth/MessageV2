from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.session import get_db
from backend.repositories.contact_repository import ContactRepository
from backend.repositories.task_repository import TaskRepository

router = APIRouter(prefix="/api/contacts", tags=["contacts"])

@router.get("")
async def list_contacts(limit: int = 100, offset: int = 0, db: AsyncSession = Depends(get_db)):
    repo = ContactRepository(db)
    contacts = await repo.list_all(limit, offset)
    task_repo = TaskRepository(db)
    result = []
    for c in contacts:
        tasks = await task_repo.list_tasks()
        contact_tasks = [t for t in tasks if t.contact_id == c.id]
        latest_status = contact_tasks[0].status if contact_tasks else "NO_TASK"
        latest_attempts = contact_tasks[0].attempt_count if contact_tasks else 0
        result.append({
            "id": c.id,
            "name": c.name,
            "instagram_url": c.instagram_url,
            "username": c.username,
            "message": c.message,
            "expected_followers": c.expected_followers,
            "replied_status": c.replied_status,
            "notes": c.notes,
            "task_status": latest_status,
            "attempts": latest_attempts,
            "created_at": c.created_at,
            "updated_at": c.updated_at
        })
    return result

@router.get("/export/excel")
async def export_contacts_excel(db: AsyncSession = Depends(get_db)):
    """Export all contacts with full 1st message, follow-up 1, and follow-up 2 tracking to Excel (.xlsx)."""
    from fastapi.responses import StreamingResponse
    from datetime import datetime
    from backend.services.export_service import ExportService
    
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
        "expected_followers": contact.expected_followers,
        "replied_status": contact.replied_status,
        "notes": contact.notes,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at
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
