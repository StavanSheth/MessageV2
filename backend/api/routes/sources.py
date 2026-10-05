import os
import shutil
import uuid
import json
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_, desc

from backend.database.session import get_db
from backend.repositories.source_repository import SourceRepository
from backend.repositories.contact_repository import ContactRepository
from backend.repositories.task_repository import TaskRepository
from backend.repositories.event_repository import EventRepository
from backend.services.export_service import ExportService
from backend.sources.xlsx.adapter import LocalXlsxSource
from backend.sources.browser_sheet.adapter import BrowserSpreadsheetSource
from backend.domain.enums import EventCode
from backend.events.event_bus import event_bus
from backend.config.settings import DATA_DIR
from backend.database.models import Contact, Task, Message, Source, SourceRecord, OutreachHistory, Event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sources", tags=["sources"])

# In-memory staging store for pre-import redundancy inspection & review
STAGED_IMPORTS: Dict[str, Dict[str, Any]] = {}


async def _analyze_records_internal(records: list, db: AsyncSession, contact_repo: ContactRepository):
    unique_records = []
    duplicate_records = []
    invalid_records = []

    for idx, rec in enumerate(records):
        if not rec.get("is_valid", True):
            invalid_records.append({
                "index": idx,
                "error": rec.get("error", "Invalid data row"),
                "raw": rec.get("raw", {})
            })
            continue

        norm = rec.get("normalized", {})
        instagram_url = norm.get("instagram_url", "")
        username = norm.get("username")

        # Check existing contact
        existing = await contact_repo.get_by_instagram(instagram_url, username)

        # Check outreach history
        conditions = []
        if username:
            conditions.append(OutreachHistory.username == username)
        if instagram_url:
            conditions.append(OutreachHistory.instagram_url == instagram_url)
        hist_check = None
        if conditions:
            hist_check = (await db.execute(select(OutreachHistory).where(or_(*conditions)))).scalars().first()

        if existing:
            duplicate_records.append({
                "index": idx,
                "name": norm.get("name", "") or existing.name,
                "username": username or existing.username,
                "instagram_url": instagram_url or existing.instagram_url,
                "message": norm.get("message", "Hey"),
                "notes": norm.get("notes", ""),
                "existing_id": existing.id,
                "existing_name": existing.name,
                "existing_username": existing.username,
                "existing_replied_status": existing.replied_status,
                "previously_contacted": bool(hist_check),
                "reason": f"Matches existing lead '{existing.name}' (@{existing.username or 'unknown'}) [Status: {existing.replied_status}]",
                "raw": rec.get("raw", {}),
                "normalized": norm
            })
        else:
            unique_records.append({
                "index": idx,
                "name": norm.get("name", ""),
                "username": username,
                "instagram_url": instagram_url,
                "message": norm.get("message", "Hey"),
                "followup_1_message": norm.get("followup_1_message"),
                "followup_1_delay_days": norm.get("followup_1_delay_days", 3),
                "followup_2_message": norm.get("followup_2_message"),
                "followup_2_delay_days": norm.get("followup_2_delay_days", 5),
                "expected_followers": norm.get("expected_followers"),
                "notes": norm.get("notes"),
                "previously_contacted": bool(hist_check),
                "raw": rec.get("raw", {}),
                "normalized": norm
            })

    return unique_records, duplicate_records, invalid_records


# ─────────────────────────────────────────────────────────────
# 1. Staged Redundancy Analysis (Inspect before importing)
# ─────────────────────────────────────────────────────────────

@router.post("/analyze-xlsx")
async def analyze_xlsx(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only .xlsx files are supported")

    upload_dir = DATA_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    staging_file = upload_dir / f"stage_{uuid.uuid4()}_{file.filename}"

    with open(staging_file, "wb") as f:
        shutil.copyfileobj(file.file, f)

    adapter = LocalXlsxSource(str(staging_file))
    try:
        result = await adapter.sync()
    except ValueError as ve:
        raise HTTPException(400, detail=str(ve))
    finally:
        await adapter.close()

    contact_repo = ContactRepository(db)
    unique_recs, dup_recs, inv_recs = await _analyze_records_internal(result["records"], db, contact_repo)

    staging_id = str(uuid.uuid4())
    STAGED_IMPORTS[staging_id] = {
        "created_at": datetime.now(timezone.utc),
        "source_type": "XLSX",
        "name": file.filename,
        "file_path_or_url": str(staging_file),
        "total_records": len(result["records"]),
        "unique_records": unique_recs,
        "duplicate_records": dup_recs,
        "invalid_records": inv_recs,
        "sheets_processed": result.get("sheets_processed", []),
        "sheets_skipped": result.get("sheets_skipped", [])
    }

    return {
        "staging_id": staging_id,
        "source_name": file.filename,
        "source_type": "XLSX",
        "total_fetched": len(result["records"]),
        "unique_count": len(unique_recs),
        "duplicate_count": len(dup_recs),
        "invalid_count": len(inv_recs),
        "unique_records": unique_recs,
        "duplicate_records": dup_recs,
        "invalid_records": inv_recs,
        "sheets_processed": result.get("sheets_processed", []),
        "sheets_skipped": result.get("sheets_skipped", [])
    }


class UrlSourcePayload(BaseModel):
    url: str
    name: Optional[str] = None


@router.post("/analyze-url")
async def analyze_url(payload: UrlSourcePayload, db: AsyncSession = Depends(get_db)):
    adapter = BrowserSpreadsheetSource(payload.url)
    try:
        accessible, reason = await adapter.validate_access()
        if not accessible:
            raise HTTPException(403, f"Source not accessible: {reason}")
        result = await adapter.sync()
    except Exception as e:
        raise HTTPException(400, f"Failed to sync URL: {str(e)}")
    finally:
        await adapter.close()

    contact_repo = ContactRepository(db)
    unique_recs, dup_recs, inv_recs = await _analyze_records_internal(result["records"], db, contact_repo)

    staging_id = str(uuid.uuid4())
    name = payload.name or payload.url[:80]
    STAGED_IMPORTS[staging_id] = {
        "created_at": datetime.now(timezone.utc),
        "source_type": "BROWSER_SHEET",
        "name": name,
        "file_path_or_url": payload.url,
        "total_records": len(result["records"]),
        "unique_records": unique_recs,
        "duplicate_records": dup_recs,
        "invalid_records": inv_recs,
        "sheets_processed": result.get("sheets_processed", []),
        "sheets_skipped": result.get("sheets_skipped", [])
    }

    return {
        "staging_id": staging_id,
        "source_name": name,
        "source_type": "BROWSER_SHEET",
        "total_fetched": len(result["records"]),
        "unique_count": len(unique_recs),
        "duplicate_count": len(dup_recs),
        "invalid_count": len(inv_recs),
        "unique_records": unique_recs,
        "duplicate_records": dup_recs,
        "invalid_records": inv_recs,
        "sheets_processed": result.get("sheets_processed", []),
        "sheets_skipped": result.get("sheets_skipped", [])
    }


class ConfirmImportRequest(BaseModel):
    staging_id: str
    source_name: Optional[str] = None
    selected_unique_indices: List[int] = []
    selected_duplicate_indices: List[int] = []
    duplicate_mode: str = "SKIP"  # "SKIP", "ADD_SEPARATELY", "MERGE_UPDATE"


@router.post("/confirm-import")
async def confirm_staged_import(payload: ConfirmImportRequest, db: AsyncSession = Depends(get_db)):
    staged = STAGED_IMPORTS.get(payload.staging_id)
    if not staged:
        raise HTTPException(400, "Staged import session expired or not found. Please analyze file again.")

    source_repo = SourceRepository(db)
    contact_repo = ContactRepository(db)
    task_repo = TaskRepository(db)
    event_repo = EventRepository(db)

    source_name = payload.source_name or staged["name"]
    source = await source_repo.create_source(staged["source_type"], source_name, staged["file_path_or_url"])

    imported = 0
    unique_added = 0
    duplicates_added = 0
    duplicates_merged = 0
    duplicates_skipped = 0

    selected_unique_set = set(payload.selected_unique_indices)
    selected_dup_set = set(payload.selected_duplicate_indices)

    try:
        # 1. Process Unique Records
        for item in staged["unique_records"]:
            idx = item["index"]
            norm = item.get("normalized", {})
            if idx not in selected_unique_set:
                continue

            raw_rec = await source_repo.create_record(
                source_id=source.id,
                raw_data=item.get("raw", {}),
                normalized_data=norm,
                status="VALID"
            )
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
                replied_status="UNKNOWN"
            )
            await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
            imported += 1
            unique_added += 1
            await event_repo.log_event(EventCode.CONTACT_CREATED, {"contact_id": contact.id, "name": contact.name})
            await event_repo.log_event(EventCode.TASK_CREATED, {"contact_id": contact.id})

        # 2. Process Duplicate Records
        for item in staged["duplicate_records"]:
            idx = item["index"]
            norm = item.get("normalized", {})
            add_individually = idx in selected_dup_set
            
            should_add_separately = (payload.duplicate_mode == "ADD_SEPARATELY") or add_individually
            should_merge = (payload.duplicate_mode == "MERGE_UPDATE") and not add_individually
            
            if should_add_separately:
                raw_rec = await source_repo.create_record(
                    source_id=source.id,
                    raw_data=item.get("raw", {}),
                    normalized_data=norm,
                    status="VALID"
                )
                note_text = norm.get("notes") or ""
                note_text = f"{note_text} [Duplicate Imported Separately]".strip()
                contact = await contact_repo.create(
                    name=norm.get("name", "") or item.get("name", ""),
                    instagram_url=norm.get("instagram_url", "") or item.get("instagram_url", ""),
                    username=norm.get("username") or item.get("username"),
                    message=norm.get("message", "Hey"),
                    expected_followers=norm.get("expected_followers"),
                    source_record_id=raw_rec.id,
                    notes=note_text,
                    followup_1_message=norm.get("followup_1_message"),
                    followup_1_delay_days=norm.get("followup_1_delay_days", 3),
                    followup_2_message=norm.get("followup_2_message"),
                    followup_2_delay_days=norm.get("followup_2_delay_days", 5),
                    replied_status="UNKNOWN"
                )
                await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
                imported += 1
                duplicates_added += 1
                await event_repo.log_event(EventCode.CONTACT_CREATED, {"contact_id": contact.id, "name": contact.name, "is_duplicate_copy": True})
                await event_repo.log_event(EventCode.TASK_CREATED, {"contact_id": contact.id})

            elif should_merge:
                existing_id = item.get("existing_id")
                if existing_id:
                    existing = await contact_repo.get_by_id(existing_id)
                    if existing:
                        if norm.get("notes") and not existing.notes:
                            existing.notes = norm.get("notes")
                        if norm.get("followup_1_message") and not existing.followup_1_message:
                            existing.followup_1_message = norm.get("followup_1_message")
                        if norm.get("followup_2_message") and not existing.followup_2_message:
                            existing.followup_2_message = norm.get("followup_2_message")
                        if norm.get("message") and norm["message"] not in ["Hey", ""]:
                            existing.message = norm["message"]
                        duplicates_merged += 1
            else:
                duplicates_skipped += 1

        total_rows = staged["total_records"]
        valid_rows = len(staged["unique_records"]) + len(staged["duplicate_records"])
        invalid_rows = len(staged["invalid_records"])

        await source_repo.update_counts(source.id, total_rows, valid_rows, invalid_rows, imported)
        await db.commit()

        # Clean staging entry
        STAGED_IMPORTS.pop(payload.staging_id, None)

        payload_summary = {
            "source_id": source.id,
            "total_records": total_rows,
            "valid_records": valid_rows,
            "invalid_records": invalid_rows,
            "imported": imported,
            "tasks_created": imported,
            "unique_added": unique_added,
            "unique_removed": len(staged["unique_records"]) - len(selected_unique_set),
            "duplicates_added": duplicates_added,
            "duplicates_merged": duplicates_merged,
            "duplicates_skipped": duplicates_skipped,
            "status": "ok"
        }
        await event_repo.log_event(EventCode.SOURCE_IMPORTED, payload_summary)
        await event_bus.publish(EventCode.SOURCE_IMPORTED, payload_summary)
        return payload_summary

    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to confirm staged import: {e}", exc_info=True)
        raise HTTPException(500, f"Failed to confirm import: {str(e)}")


# ─────────────────────────────────────────────────────────────
# 2. Universal 5-Table Excel Export
# ─────────────────────────────────────────────────────────────

@router.get("/export/universal")
async def export_universal_excel(db: AsyncSession = Depends(get_db)):
    """Export all 5 core tables (Contacts, Queue, Sources, History, Events) in a single multi-sheet Excel workbook."""
    excel_stream = await ExportService.generate_universal_excel(db)
    filename = f"Universal_Instagram_Outreach_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
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


# ─────────────────────────────────────────────────────────────
# 3. In-App Data Tables Browser
# ─────────────────────────────────────────────────────────────

@router.get("/tables-data")
async def get_tables_data(db: AsyncSession = Depends(get_db)):
    """Return summary and live records for the 5 database tables to preview directly inside the Sources tab."""
    # 1. Contacts
    contacts_count = (await db.execute(select(func.count(Contact.id)))).scalar() or 0
    contacts_stmt = select(Contact).order_by(desc(Contact.created_at)).limit(50)
    contacts_rows = (await db.execute(contacts_stmt)).scalars().all()
    contacts_data = [
        {
            "id": c.id,
            "name": c.name,
            "username": c.username or "—",
            "instagram_url": c.instagram_url,
            "replied_status": c.replied_status,
            "message": c.message,
            "created_at": c.created_at.strftime("%Y-%m-%d %H:%M") if c.created_at else "—"
        }
        for c in contacts_rows
    ]

    # 2. Tasks / Queue
    tasks_count = (await db.execute(select(func.count(Task.id)))).scalar() or 0
    tasks_stmt = select(Task).order_by(desc(Task.created_at)).limit(50)
    tasks_rows = (await db.execute(tasks_stmt)).scalars().all()
    tasks_data = [
        {
            "id": t.id,
            "contact_id": t.contact_id,
            "type": t.type,
            "status": t.status,
            "run_id": t.run_id or "—",
            "attempt_count": t.attempt_count,
            "scheduled_at": t.scheduled_at.strftime("%Y-%m-%d %H:%M") if t.scheduled_at else "—",
            "completed_at": t.completed_at.strftime("%Y-%m-%d %H:%M") if t.completed_at else "—"
        }
        for t in tasks_rows
    ]

    # 3. Sources
    sources_count = (await db.execute(select(func.count(Source.id)))).scalar() or 0
    sources_stmt = select(Source).order_by(desc(Source.created_at)).limit(50)
    sources_rows = (await db.execute(sources_stmt)).scalars().all()
    sources_data = [
        {
            "id": s.id,
            "name": s.name,
            "type": s.type,
            "total_rows": s.total_rows,
            "valid_rows": s.valid_rows,
            "imported_rows": s.imported_rows,
            "status": s.status,
            "created_at": s.created_at.strftime("%Y-%m-%d %H:%M") if s.created_at else "—"
        }
        for s in sources_rows
    ]

    # 4. Outreach History
    history_count = (await db.execute(select(func.count(OutreachHistory.id)))).scalar() or 0
    history_stmt = select(OutreachHistory).order_by(desc(OutreachHistory.created_at)).limit(50)
    history_rows = (await db.execute(history_stmt)).scalars().all()
    history_data = [
        {
            "id": h.id,
            "contact_name": h.contact_name or "—",
            "username": h.username or "—",
            "action": h.action,
            "run_id": h.run_id or "—",
            "details": h.details or "—",
            "created_at": h.created_at.strftime("%Y-%m-%d %H:%M") if h.created_at else "—"
        }
        for h in history_rows
    ]

    # 5. Audit Events
    events_count = (await db.execute(select(func.count(Event.id)))).scalar() or 0
    events_stmt = select(Event).order_by(desc(Event.timestamp)).limit(50)
    events_rows = (await db.execute(events_stmt)).scalars().all()
    events_data = [
        {
            "id": e.id,
            "event_code": e.event_code,
            "level": e.level,
            "category": e.category,
            "timestamp": e.timestamp.strftime("%Y-%m-%d %H:%M:%S") if e.timestamp else "—"
        }
        for e in events_rows
    ]

    return {
        "total_tables": 5,
        "tables": {
            "contacts": {
                "title": "Contacts Directory",
                "count": contacts_count,
                "columns": ["Name", "Username", "Status", "Message", "Created"],
                "rows": contacts_data
            },
            "tasks": {
                "title": "Dispatch Queue",
                "count": tasks_count,
                "columns": ["Task ID", "Type", "Status", "Run ID", "Scheduled", "Completed"],
                "rows": tasks_data
            },
            "sources": {
                "title": "Ingested Sources",
                "count": sources_count,
                "columns": ["Name", "Type", "Total", "Valid", "Imported", "Status"],
                "rows": sources_data
            },
            "history": {
                "title": "Outreach History",
                "count": history_count,
                "columns": ["Contact", "Username", "Action", "Run ID", "Timestamp"],
                "rows": history_data
            },
            "events": {
                "title": "Audit Event Logs",
                "count": events_count,
                "columns": ["Event Code", "Level", "Category", "Timestamp"],
                "rows": events_data
            }
        }
    }


# ─────────────────────────────────────────────────────────────
# 4. Standard Direct Ingestion (Preserved for compatibility)
# ─────────────────────────────────────────────────────────────

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
                if norm.get("notes") and not existing.notes:
                    existing.notes = norm.get("notes")
                if norm.get("followup_1_message") and not existing.followup_1_message:
                    existing.followup_1_message = norm.get("followup_1_message")
                if norm.get("followup_2_message") and not existing.followup_2_message:
                    existing.followup_2_message = norm.get("followup_2_message")
                if norm.get("expected_followers") and not existing.expected_followers:
                    existing.expected_followers = norm.get("expected_followers")
                if norm.get("message") and norm["message"] not in ["Hey", ""]:
                    existing.message = norm["message"]

        await source_repo.update_counts(source.id, len(records), valid_count, invalid_count, imported)
        await db.commit()

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
        for rec in records:
            norm = rec.get("normalized", {})
            raw_rec = await source_repo.create_record(
                source.id,
                rec.get("raw", {}),
                norm,
                status="VALID" if rec["is_valid"] else "INVALID",
                error_message=rec.get("error")
            )
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
    return [{
        "id": s.id,
        "type": s.type,
        "name": s.name,
        "url_or_path": s.file_path_or_url,
        "total_rows": s.total_rows,
        "valid_rows": s.valid_rows,
        "invalid_rows": s.invalid_rows,
        "imported_rows": s.imported_rows,
        "status": s.status,
        "last_sync_at": s.last_sync_at,
        "created_at": s.created_at
    } for s in sources]


@router.get("/{source_id}")
async def get_source(source_id: str, db: AsyncSession = Depends(get_db)):
    repo = SourceRepository(db)
    source = await repo.get_by_id(source_id)
    if not source:
        raise HTTPException(404, "Source not found")
    return source
