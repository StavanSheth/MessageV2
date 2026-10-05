import os
import shutil
import uuid
import json
from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession


from backend.database.session import get_db
from backend.repositories.source_repository import SourceRepository
from backend.repositories.contact_repository import ContactRepository
from backend.repositories.task_repository import TaskRepository
from backend.repositories.event_repository import EventRepository
from backend.sources.xlsx.adapter import LocalXlsxSource
from backend.sources.browser_sheet.adapter import BrowserSpreadsheetSource
from backend.domain.enums import EventCode
from backend.events.event_bus import event_bus
from backend.config.settings import DATA_DIR

router = APIRouter(prefix="/api/sources", tags=["sources"])

@router.post("/upload")
async def upload_xlsx(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only .xlsx files are supported")

    upload_dir = DATA_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / f"{uuid.uuid4()}_{file.filename}"

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    source_repo = SourceRepository(db)
    contact_repo = ContactRepository(db)
    task_repo = TaskRepository(db)
    event_repo = EventRepository(db)

    source = await source_repo.create_source("XLSX", file.filename, str(dest))

    adapter = LocalXlsxSource(str(dest))
    try:
        try:
            result = await adapter.sync()
        except ValueError as ve:
            logger.warning(f"Spreadsheet import column mismatch: {ve}")
            raise HTTPException(400, detail=str(ve))

        records = result["records"]
        valid_count = result["valid"]
        invalid_count = result["invalid"]

        imported = 0
        existing_contacts_updated = 0
        previously_messaged_count = 0
        try:
            from backend.database.models import OutreachHistory
            from sqlalchemy import select, or_

            for rec in records:
                norm = rec.get("normalized", {})
                raw_rec = await source_repo.create_record(
                    source_id=source.id,
                    raw_data=rec.get("raw", {}),
                    normalized_data=norm,
                    status="VALID" if rec["is_valid"] else "INVALID",
                    error_message=rec.get("error")
                )

                if not rec["is_valid"]:
                    continue

                # Check if this contact has outreach history
                conditions = []
                if norm.get("username"):
                    conditions.append(OutreachHistory.username == norm.get("username"))
                if norm.get("instagram_url"):
                    conditions.append(OutreachHistory.instagram_url == norm.get("instagram_url"))
                if conditions:
                    hist_check = (await db.execute(select(OutreachHistory).where(or_(*conditions)))).scalars().first()
                    if hist_check:
                        previously_messaged_count += 1

                # Canonical duplicate check
                existing = await contact_repo.get_by_instagram(norm["instagram_url"], norm.get("username"))
                if not existing:
                    contact = await contact_repo.create(
                        name=norm.get("name", ""),
                        instagram_url=norm.get("instagram_url", ""),
                        username=norm.get("username"),
                        message=norm.get("message", "Hey"),
                        expected_followers=norm.get("expected_followers"),
                        source_record_id=raw_rec.id,
                        notes=norm.get("notes"),
                        followup_1_message=norm.get("followup_1_message"),
                        followup_1_delay_days=norm.get("followup_1_delay_days", 3),
                        followup_2_message=norm.get("followup_2_message"),
                        followup_2_delay_days=norm.get("followup_2_delay_days", 5),
                        replied_status=norm.get("replied_status", "UNKNOWN")
                    )
                    await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
                    imported += 1
                    await event_repo.log_event(EventCode.CONTACT_CREATED, {"contact_id": contact.id, "name": contact.name})
                    await event_repo.log_event(EventCode.TASK_CREATED, {"contact_id": contact.id})
                else:
                    existing_contacts_updated += 1
                    # Link source record to existing contact and enrich empty fields
                    if norm.get("notes") and not existing.notes:
                        existing.notes = norm.get("notes")
                    if norm.get("followup_1_message") and not existing.followup_1_message:
                        existing.followup_1_message = norm.get("followup_1_message")
                    if norm.get("followup_2_message") and not existing.followup_2_message:
                        existing.followup_2_message = norm.get("followup_2_message")
                    if norm.get("expected_followers") and not existing.expected_followers:
                        existing.expected_followers = norm.get("expected_followers")
                    # If existing contact has an unsent MESSAGE task and sheet supplies custom copy, refresh it
                    if norm.get("message") and norm["message"] not in ["Hey", ""]:
                        m_task_stmt = select(Task).where(
                            and_(Task.contact_id == existing.id, Task.type == "MESSAGE", Task.status.in_(["READY", "CREATED", "QUEUED"]))
                        )
                        m_task = (await db.execute(m_task_stmt)).scalar_one_or_none()
                        if m_task:
                            existing.message = norm["message"]

            await source_repo.update_counts(source.id, len(records), valid_count, invalid_count, imported)
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.error(f"Failed to process source import: {e}", exc_info=True)
            raise HTTPException(500, f"Failed to import records: {str(e)}")

        payload = {
            "source_id": source.id,
            "total": len(records),
            "valid": valid_count,
            "invalid": invalid_count,
            "imported": imported,
            "new_contacts_created": imported,
            "existing_contacts_updated": existing_contacts_updated,
            "previously_contacted": previously_messaged_count,
            "sheets_processed": result.get("sheets_processed", []),
            "sheets_skipped": result.get("sheets_skipped", [])
        }
        await event_repo.log_event(EventCode.SOURCE_IMPORTED, payload)
        await event_bus.publish(EventCode.SOURCE_IMPORTED, payload)

        return {
            "source_id": source.id,
            "total": len(records),
            "total_records": len(records),
            "valid": valid_count,
            "valid_records": valid_count,
            "invalid": invalid_count,
            "imported": imported,
            "tasks_created": imported,
            "new_contacts_created": imported,
            "existing_contacts_updated": existing_contacts_updated,
            "previously_contacted": previously_messaged_count,
            "sheets_processed": result.get("sheets_processed", []),
            "sheets_skipped": result.get("sheets_skipped", []),
            "status": "ok"
        }
    finally:
        await adapter.close()


class UrlSourcePayload(BaseModel):
    url: str
    name: Optional[str] = None

@router.post("/url")
async def import_spreadsheet_url(payload: UrlSourcePayload, db: AsyncSession = Depends(get_db)):
    url = payload.url
    name = payload.name
    source_repo = SourceRepository(db)

    contact_repo = ContactRepository(db)
    task_repo = TaskRepository(db)
    event_repo = EventRepository(db)

    source = await source_repo.create_source("BROWSER_SHEET", name or url[:80], url)
    adapter = BrowserSpreadsheetSource(url)

    try:
        accessible, reason = await adapter.validate_access()
        if not accessible:
            await source_repo.update_counts(source.id, 0, 0, 0, 0, "ACCESS_PROHIBITED")
            await event_repo.log_event(EventCode.ACCESS_PROHIBITED, {"url": url, "reason": reason}, level="ERROR")
            await event_bus.publish(EventCode.ACCESS_PROHIBITED, {"url": url, "reason": reason})
            raise HTTPException(403, f"Source not accessible: {reason}")

        result = await adapter.sync()
        records = result["records"]
        valid_count = result["valid"]
        invalid_count = result["invalid"]

        imported = 0
        try:
            for rec in records:
                norm = rec.get("normalized", {})
                raw_rec = await source_repo.create_record(source.id, rec.get("raw", {}), norm,
                                                           status="VALID" if rec["is_valid"] else "INVALID",
                                                           error_message=rec.get("error"))
                if not rec["is_valid"]:
                    continue
                existing = await contact_repo.get_by_instagram(norm["instagram_url"], norm.get("username"))
                if not existing:
                    contact = await contact_repo.create(
                        name=norm.get("name", ""),
                        instagram_url=norm.get("instagram_url", ""),
                        username=norm.get("username"),
                        message=norm.get("message", "Hey"),
                        source_record_id=raw_rec.id
                    )
                    await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
                    imported += 1

            await source_repo.update_counts(source.id, len(records), valid_count, invalid_count, imported)
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.error(f"Failed to import URL source records: {e}", exc_info=True)
            raise HTTPException(500, f"Failed to import records: {str(e)}")
        return {
            "source_id": source.id,
            "total": len(records),
            "total_records": len(records),
            "valid": valid_count,
            "valid_records": valid_count,
            "invalid": invalid_count,
            "imported": imported,
            "tasks_created": imported,
            "status": "ok"
        }
    finally:
        await adapter.close()



@router.get("")
async def list_sources(db: AsyncSession = Depends(get_db)):
    repo = SourceRepository(db)
    sources = await repo.list_sources()
    return [{"id": s.id, "type": s.type, "name": s.name, "url_or_path": s.file_path_or_url,
             "total_rows": s.total_rows, "valid_rows": s.valid_rows, "invalid_rows": s.invalid_rows,
             "imported_rows": s.imported_rows, "status": s.status, "last_sync_at": s.last_sync_at,
             "created_at": s.created_at} for s in sources]


@router.get("/{source_id}")
async def get_source(source_id: str, db: AsyncSession = Depends(get_db)):
    repo = SourceRepository(db)
    source = await repo.get_by_id(source_id)
    if not source:
        raise HTTPException(404, "Source not found")
    return source
