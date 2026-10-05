"""
Worker 2: Instagram Direct Inbox & Reply Scanner.
Scans conversations in Instagram Direct Inbox, detects inbound replies,
classifies automated vs human responses, and extracts lead assets (phone, email, links).
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional

from sqlalchemy import select, and_
from backend.database.session import AsyncSessionLocal
from backend.database.models import Contact, Task
from backend.automation.extension_bridge import extension_bridge
from backend.services.entity_extractor import entity_extractor
from backend.events.event_bus import event_bus
from backend.domain.enums import EventCode, TaskStatus

logger = logging.getLogger(__name__)

class ReplyScannerWorker:
    def __init__(self):
        self.status = "IDLE"  # IDLE, SCANNING, ERROR
        self.current_stage = "IDLE"  # IDLE, OPENING_INBOX, SCANNING_THREADS, INSPECTING_THREAD, CLASSIFYING_REPLY, EXTRACTING_ENTITIES, UPDATING_RECORDS, COMPLETED
        self.current_target: Optional[Dict[str, Any]] = None
        self.last_scanned_at: Optional[datetime] = None
        self.stats = {
            "total_scanned": 0,
            "automated_found": 0,
            "human_replies_found": 0,
            "no_reply_count": 0
        }
        self._lock = asyncio.Lock()

    def get_status(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "current_stage": self.current_stage,
            "current_target": self.current_target,
            "last_scanned_at": self.last_scanned_at.isoformat() if self.last_scanned_at else None,
            "stats": self.stats,
            "is_connected": extension_bridge.is_connected
        }

    async def scan_inbox(self) -> Dict[str, Any]:
        """Perform a complete scan of the Instagram Direct Inbox."""
        if not extension_bridge.is_connected:
            return {"success": False, "error": "Chrome Extension is not connected"}

        if self.status == "SCANNING":
            return {"success": False, "error": "Reply scanner is already running"}

        async with self._lock:
            self.status = "SCANNING"
            self.current_stage = "OPENING_INBOX"
            now = datetime.now(timezone.utc)
            scanned_count = 0
            auto_count = 0
            human_count = 0
            no_reply = 0

            try:
                logger.info("[ReplyScanner] Starting Instagram inbox reply audit...")
                self.current_stage = "SCANNING_THREADS"
                res = await extension_bridge.scan_inbox_replies()
                if not res.get("success"):
                    self.status = "IDLE"
                    self.current_stage = "IDLE"
                    return {"success": False, "error": res.get("error", "Failed to scan inbox")}

                threads = res.get("threads", [])
                logger.info(f"[ReplyScanner] Found {len(threads)} threads in Instagram inbox.")

                async with AsyncSessionLocal() as session:
                    # Load all contacts from DB for matching
                    stmt = select(Contact)
                    all_contacts = (await session.execute(stmt)).scalars().all()

                    for thread in threads:
                        thread_name = (thread.get("name") or "").strip().lower()
                        snippet = thread.get("snippet", "")
                        has_reply = thread.get("has_reply", False)
                        thread_href = thread.get("href", "")

                        if not thread_name:
                            continue

                        # Match contact by name or username
                        matched_contact = None
                        for c in all_contacts:
                            c_name = (c.name or "").strip().lower()
                            c_user = (c.username or "").strip().lower()
                            if (c_name and (c_name in thread_name or thread_name in c_name)) or \
                               (c_user and (c_user in thread_name or thread_name in c_user)):
                                matched_contact = c
                                break

                        if not matched_contact:
                            continue

                        scanned_count += 1
                        matched_contact.last_checked_reply_at = now

                        self.current_stage = "INSPECTING_THREAD"
                        self.current_target = {
                            "name": matched_contact.name,
                            "username": matched_contact.username,
                            "thread_href": thread_href,
                            "snippet": snippet,
                            "has_reply": has_reply
                        }

                        if has_reply:
                            # Contact sent an inbound message! Inspect thread for full message text
                            inspect_res = await extension_bridge.inspect_thread_reply(thread_href)
                            inbound_text = snippet
                            if inspect_res.get("success") and inspect_res.get("data", {}).get("text"):
                                inbound_text = inspect_res["data"]["text"]

                            # Run classification & entity extraction
                            self.current_stage = "CLASSIFYING_REPLY"
                            extracted = entity_extractor.extract_all(inbound_text)

                            self.current_stage = "EXTRACTING_ENTITIES"
                            self.current_target["entities"] = extracted
                            self.current_target["full_text"] = inbound_text

                            self.current_stage = "UPDATING_RECORDS"
                            if extracted["is_automated"]:
                                auto_count += 1
                                matched_contact.replied_status = "AUTOMATED_MESSAGE"
                                matched_contact.auto_reply_message = inbound_text
                                matched_contact.extracted_phone = extracted["phone"]
                                matched_contact.extracted_email = extracted["email"]
                                matched_contact.extracted_link = extracted["link"]
                                matched_contact.reply_detected_at = now
                                matched_contact.notes = (matched_contact.notes or "") + f" [Auto-Reply: {inbound_text[:80]}...]"

                                # Cancel further scheduled follow-ups
                                fu_stmt = select(Task).where(
                                    and_(Task.contact_id == matched_contact.id, Task.status == TaskStatus.READY.value)
                                )
                                ready_tasks = (await session.execute(fu_stmt)).scalars().all()
                                for rt in ready_tasks:
                                    rt.status = TaskStatus.CANCELLED.value

                                logger.info(f"[ReplyScanner] Automated message detected from {matched_contact.name}: Phone={extracted['phone']}, Email={extracted['email']}")
                            else:
                                human_count += 1
                                matched_contact.replied_status = "YES"
                                matched_contact.auto_reply_message = inbound_text
                                matched_contact.extracted_phone = extracted["phone"]
                                matched_contact.extracted_email = extracted["email"]
                                matched_contact.extracted_link = extracted["link"]
                                matched_contact.reply_detected_at = now

                                # Cancel further scheduled follow-ups
                                fu_stmt = select(Task).where(
                                    and_(Task.contact_id == matched_contact.id, Task.status == TaskStatus.READY.value)
                                )
                                ready_tasks = (await session.execute(fu_stmt)).scalars().all()
                                for rt in ready_tasks:
                                    rt.status = TaskStatus.CANCELLED.value

                                logger.info(f"[ReplyScanner] Human reply detected from {matched_contact.name}: {inbound_text[:80]}")
                        else:
                            # No reply yet
                            no_reply += 1
                            if matched_contact.replied_status == "UNKNOWN":
                                matched_contact.replied_status = "NO_REPLY"

                    await session.commit()

                self.current_stage = "COMPLETED"
                self.last_scanned_at = now
                self.stats["total_scanned"] += scanned_count
                self.stats["automated_found"] += auto_count
                self.stats["human_replies_found"] += human_count
                self.stats["no_reply_count"] += no_reply

                result_summary = {
                    "success": True,
                    "scanned_count": scanned_count,
                    "automated_found": auto_count,
                    "human_replies_found": human_count,
                    "no_reply_count": no_reply,
                    "scanned_at": now.isoformat()
                }

                logger.info(f"[ReplyScanner] Scan completed: {result_summary}")
                await event_bus.publish(
                    EventCode.CONTACT_UPDATED,
                    payload={"type": "REPLY_SCAN_COMPLETED", **result_summary}
                )
                return result_summary

            except Exception as e:
                logger.exception(f"[ReplyScanner] Scan error: {e}")
                return {"success": False, "error": str(e)}
            finally:
                self.status = "IDLE"
                self.current_stage = "IDLE"

reply_scanner_worker = ReplyScannerWorker()
