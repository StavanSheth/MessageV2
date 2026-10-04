import os
import shutil
import uuid
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
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

    adapter = LocalXlsxSource(str(dest))
    try:
        # 1. Source Access Validation
        accessible, reason = await adapter.validate_access()
        if not accessible:
            if os.path.exists(dest):
                os.remove(dest)
            raise HTTPException(400, f"Cannot process spreadsheet: {reason}")

        # 2. Parse & Stage complete records
        sync_result = await adapter.sync()
        records = sync_result["records"]
        valid_count = sync_result["valid"]
        invalid_count = sync_result["invalid"]

        if not records:
            raise HTTPException(400, "Uploaded spreadsheet contains no readable rows")

    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(dest):
            os.remove(dest)
        raise HTTPException(500, f"Failed to parse source file: {str(e)}")
    finally:
        await adapter.close()

    # 3. Transactional Staging and Deduplication
    source_repo = SourceRepository(db)
    contact_repo = ContactRepository(db)
    task_repo = TaskRepository(db)
    event_repo = EventRepository(db)

    try:
        # Create source record
        source = await source_repo.create_source("XLSX", file.filename, str(dest))

        imported = 0
        staged_contacts = []

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

            # Deduplication by instagram_url & username
            existing = await contact_repo.get_by_instagram(norm["instagram_url"], norm.get("username"))
            if not existing:
                contact = await contact_repo.create(
                    name=norm.get("name", ""),
                    instagram_url=norm.get("instagram_url", ""),
                    username=norm.get("username"),
                    message=norm.get("message", "Hey"),
                    expected_followers=norm.get("expected_followers"),
                    source_record_id=raw_rec.id,
                    notes=norm.get("notes")
                )
                idempotency_key = f"task_{contact.id}_MESSAGE"
                await task_repo.create(contact_id=contact.id, task_type="MESSAGE", idempotency_key=idempotency_key)
                imported += 1
                staged_contacts.append(contact)

        # Update source summary counts
        await source_repo.update_counts(source.id, len(records), valid_count, invalid_count, imported)

        # Commit entire batch transactionally
        await db.commit()

        # Log and publish events post-commit
        for c in staged_contacts:
            await event_repo.log_event(EventCode.CONTACT_CREATED, {"contact_id": c.id, "name": c.name})
            await event_repo.log_event(EventCode.TASK_CREATED, {"contact_id": c.id})

        payload = {
            "source_id": source.id,
            "total": len(records),
            "valid": valid_count,
            "invalid": invalid_count,
            "imported": imported
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
            "status": "ok"
        }

    except Exception as e:
        # Atomic rollback on any failure
        await db.rollback()
        if os.path.exists(dest):
            try:
                os.remove(dest)
            except Exception:
                pass
        raise HTTPException(500, f"Source import transaction failed: {str(e)}")


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

    adapter = BrowserSpreadsheetSource(url)
    try:
        accessible, reason = await adapter.validate_access()
        if not accessible:
            source = await source_repo.create_source("BROWSER_SHEET", name or url[:80], url)
            await source_repo.update_counts(source.id, 0, 0, 0, 0, "ACCESS_FAILED")
            await event_repo.log_event(EventCode.ACCESS_PROHIBITED, {"url": url, "reason": reason}, level="ERROR")
            await event_bus.publish(EventCode.ACCESS_PROHIBITED, {"url": url, "reason": reason})
            raise HTTPException(403, f"Source not accessible: {reason}")

        result = await adapter.sync()
        records = result["records"]
        valid_count = result["valid"]
        invalid_count = result["invalid"]

        source = await source_repo.create_source("BROWSER_SHEET", name or url[:80], url)
        imported = 0
        staged_contacts = []

        for rec in records:
            norm = rec.get("normalized", {})
            raw_rec = await source_repo.create_record(
                source.id, rec.get("raw", {}), norm,
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
                    expected_followers=norm.get("expected_followers"),
                    source_record_id=raw_rec.id,
                    notes=norm.get("notes")
                )
                idempotency_key = f"task_{contact.id}_MESSAGE"
                await task_repo.create(contact_id=contact.id, task_type="MESSAGE", idempotency_key=idempotency_key)
                imported += 1
                staged_contacts.append(contact)

        await source_repo.update_counts(source.id, len(records), valid_count, invalid_count, imported)
        await db.commit()

        for c in staged_contacts:
            await event_repo.log_event(EventCode.CONTACT_CREATED, {"contact_id": c.id, "name": c.name})
            await event_repo.log_event(EventCode.TASK_CREATED, {"contact_id": c.id})

        return {
            "source_id": source.id,
            "total": len(records),
            "valid": valid_count,
            "invalid": invalid_count,
            "imported": imported,
            "status": "ok"
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"Spreadsheet URL import failed: {str(e)}")
