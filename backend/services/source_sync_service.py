import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Task, Contact, SourceRecord, Source, Message
from backend.sources.xlsx.adapter import LocalXlsxSource
from backend.sources.browser_sheet.adapter import BrowserSpreadsheetSource
from backend.domain.enums import EventCode
from backend.events.event_bus import event_bus

logger = logging.getLogger(__name__)

class SourceSyncService:
    @staticmethod
    async def sync_task_outcome(
        session: AsyncSession,
        task_id: str,
        status: str = "SENT",
        bus=None
    ) -> bool:
        """
        Synchronize task outcome back to the original source record/spreadsheet.
        Idempotent and decoupled: failure to update source does NOT alter or invalidate
        the SENT status of the message.
        """
        active_bus = bus or event_bus
        now = datetime.now(timezone.utc)

        # 1. Fetch Task, Contact, SourceRecord, Source
        task_stmt = select(Task).where(Task.id == task_id)
        task = (await session.execute(task_stmt)).scalar_one_or_none()
        if not task:
            logger.warning(f"[SourceSync] Task {task_id} not found for source sync.")
            return False

        contact_stmt = select(Contact).where(Contact.id == task.contact_id)
        contact = (await session.execute(contact_stmt)).scalar_one_or_none()
        if not contact or not contact.source_record_id:
            # Task not linked to an external source sheet (e.g., direct manual entry)
            task.source_sync_status = "NOT_APPLICABLE"
            task.source_sync_error = None
            await session.commit()
            return True

        rec_stmt = select(SourceRecord).where(SourceRecord.id == contact.source_record_id)
        source_rec = (await session.execute(rec_stmt)).scalar_one_or_none()
        if not source_rec:
            task.source_sync_status = "SYNC_FAILED"
            task.source_sync_error = "Associated source record missing"
            await session.commit()
            if active_bus:
                await active_bus.publish(
                    EventCode.SOURCE_SYNC_FAILED,
                    task_id=task_id,
                    payload={"error": task.source_sync_error}
                )
            return False

        src_stmt = select(Source).where(Source.id == source_rec.source_id)
        source = (await session.execute(src_stmt)).scalar_one_or_none()
        if not source:
            task.source_sync_status = "SYNC_FAILED"
            task.source_sync_error = "Associated source entity missing"
            await session.commit()
            if active_bus:
                await active_bus.publish(
                    EventCode.SOURCE_SYNC_FAILED,
                    task_id=task_id,
                    payload={"error": task.source_sync_error}
                )
            return False

        # 2. Extract record row/id
        record_id = contact.username or contact.instagram_url or source_rec.id
        update_data = {
            "status": status,
            "sent_at": now.isoformat(),
            "contact_name": contact.name
        }

        # 3. Instantiate appropriate adapter
        adapter = None
        try:
            if source.type.upper() == "XLSX":
                adapter = LocalXlsxSource(source.file_path_or_url)
            elif source.type.upper() == "BROWSER_SHEET":
                adapter = BrowserSpreadsheetSource(source.file_path_or_url)
            else:
                task.source_sync_status = "NOT_APPLICABLE"
                await session.commit()
                return True

            success = await adapter.update_record(record_id, update_data)
            if success:
                task.source_sync_status = "SYNCED"
                task.source_sync_error = None
                source.last_sync_at = now
                await session.commit()
                if active_bus:
                    await active_bus.publish(
                        EventCode.SOURCE_SYNC_COMPLETED,
                        task_id=task_id,
                        payload={"source_id": source.id, "status": status}
                    )
                logger.info(f"[SourceSync] Task {task_id} successfully synced to source {source.id}")
                return True
            else:
                task.source_sync_status = "SYNC_FAILED"
                task.source_sync_error = "Adapter failed to verify written status in sheet"
                await session.commit()
                if active_bus:
                    await active_bus.publish(
                        EventCode.SOURCE_SYNC_FAILED,
                        task_id=task_id,
                        payload={"error": task.source_sync_error}
                    )
                logger.warning(f"[SourceSync] Task {task_id} source sync verification failed")
                return False

        except Exception as e:
            task.source_sync_status = "SYNC_FAILED"
            task.source_sync_error = str(e)
            await session.commit()
            if active_bus:
                await active_bus.publish(
                    EventCode.SOURCE_SYNC_FAILED,
                    task_id=task_id,
                    payload={"error": str(e)}
                )
            logger.error(f"[SourceSync] Task {task_id} error during source write-back: {e}")
            return False
        finally:
            if adapter and hasattr(adapter, "close"):
                try:
                    await adapter.close()
                except Exception:
                    pass
