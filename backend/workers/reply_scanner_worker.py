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
from backend.automation.message_matcher import is_system_sequence_message
from backend.events.event_bus import event_bus
from backend.domain.enums import EventCode, TaskStatus

logger = logging.getLogger(__name__)

class ReplyScannerWorker:
    def __init__(self):
        self.status = "IDLE"  # IDLE, SCANNING, RUNNING, PAUSED, ERROR
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
        self._paused = False
        self._stop_requested = False
        self._periodic_task: Optional[asyncio.Task] = None
        self._persisted_scan_at: Optional[str] = None

    def get_status(self) -> Dict[str, Any]:
        display_status = "PAUSED" if self._paused else self.status
        iso_scan = self.last_scanned_at.isoformat() if self.last_scanned_at else self._persisted_scan_at
        if not iso_scan:
            try:
                import asyncio
                # Use cached or sync fallback
                from backend.automation.scan_tracker import load_last_scan
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    task = asyncio.create_task(load_last_scan("WORKER-02"))
                    task.add_done_callback(lambda t: setattr(self, "_persisted_scan_at", t.result()) if not t.cancelled() and t.exception() is None else None)
            except Exception:
                pass
            iso_scan = self._persisted_scan_at

        return {
            "worker_id": "WORKER-02",
            "worker_name": "Reply Scanner & Lead Extractor",
            "status": display_status,
            "is_paused": self._paused,
            "is_running": self.status in ("RUNNING", "SCANNING") and not self._paused,
            "current_stage": self.current_stage,
            "current_target": self.current_target,
            "last_scanned_at": iso_scan,
            "last_scan_at": iso_scan,
            "stats": self.stats,
            "is_connected": extension_bridge.is_connected
        }

    async def start(self, interval_seconds: int = 45) -> Dict[str, Any]:
        """Start continuous or immediate inbox scanning."""
        if self._paused:
            await self.resume()
            return {"status": "resumed", "worker_id": "WORKER-02"}

        if self._periodic_task and not self._periodic_task.done():
            return {"status": "already_running", "worker_id": "WORKER-02"}

        self._paused = False
        self._stop_requested = False
        self.status = "RUNNING"
        self._periodic_task = asyncio.create_task(self._run_loop(interval_seconds))
        return {"status": "started", "worker_id": "WORKER-02"}

    async def _run_loop(self, interval: int):
        logger.info("[ReplyScanner] Continuous inbox review agent loop started.")
        try:
            while not self._stop_requested:
                if not self._paused:
                    try:
                        await self.scan_inbox()
                    except Exception as e:
                        logger.error(f"[ReplyScanner] Scan error in loop: {e}")

                for _ in range(interval):
                    if self._stop_requested:
                        break
                    while self._paused and not self._stop_requested:
                        await asyncio.sleep(0.5)
                    await asyncio.sleep(1)
        finally:
            self.status = "IDLE"
            self.current_stage = "IDLE"

    async def pause(self):
        self._paused = True
        self.status = "PAUSED"
        self.current_stage = "IDLE"
        try:
            from backend.automation.extension_bridge import extension_bridge
            await extension_bridge.abort_current_action()
        except Exception:
            pass
        await event_bus.publish(EventCode.WORKER_PAUSED, worker_id="WORKER-02")
        logger.info("[ReplyScanner] Worker 2 paused.")

    async def resume(self):
        self._stop_requested = False
        self._paused = False
        if not self._periodic_task or self._periodic_task.done():
            self._periodic_task = asyncio.create_task(self._run_loop(45))
        self.status = "RUNNING"
        await event_bus.publish(EventCode.WORKER_RESUMED, worker_id="WORKER-02")
        logger.info("[ReplyScanner] Worker 2 resumed.")

    async def stop(self):
        self._stop_requested = True
        self._paused = False
        try:
            from backend.automation.extension_bridge import extension_bridge
            await extension_bridge.abort_current_action()
        except Exception:
            pass
        if self._periodic_task and not self._periodic_task.done():
            self._periodic_task.cancel()
            try:
                await self._periodic_task
            except asyncio.CancelledError:
                pass
            self._periodic_task = None
        self.status = "IDLE"
        self.current_stage = "IDLE"
        await event_bus.publish(EventCode.WORKER_STOPPED, worker_id="WORKER-02")
        logger.info("[ReplyScanner] Worker 2 stopped.")

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
            self.last_scanned_at = now
            try:
                from backend.automation.scan_tracker import persist_last_scan
                self._persisted_scan_at = await persist_last_scan("WORKER-02", now)
            except Exception:
                pass
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
                        if self._paused or self._stop_requested:
                            logger.info("[ReplyScanner] Pause/Stop requested during inbox scan. Halting thread loop.")
                            break
                        thread_name = (thread.get("name") or "").strip().lower()
                        snippet = thread.get("snippet", "")
                        has_reply = thread.get("has_reply", False)
                        thread_href = thread.get("href", "")

                        if not thread_name:
                            continue

                        # Match contact by exact username or token-bounded name
                        matched_contact = None
                        clean_tname = thread_name.strip().lower()
                        thread_tokens = set(re.findall(r"[a-zA-Z0-9_\.]+", clean_tname)) if clean_tname else set()

                        for c in all_contacts:
                            c_user = (c.username or "").strip().lower().lstrip("@")
                            c_name = (c.name or "").strip().lower()

                            # 1. Exact username match
                            if c_user and (clean_tname == c_user or clean_tname == f"@{c_user}"):
                                matched_contact = c
                                break
                            # 2. Check thread_href for username
                            if c_user and thread_href and c_user in thread_href.lower():
                                matched_contact = c
                                break
                            # 3. Exact full name match
                            if c_name and clean_tname == c_name:
                                matched_contact = c
                                break
                            # 4. Thread contains exact username token
                            if c_user and c_user in thread_tokens:
                                matched_contact = c
                                break
                            # 5. Multi-word full name match
                            if c_name and len(c_name.split()) >= 2 and c_name in clean_tname:
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

                                # Hold pending/ready follow-ups in MANUAL_REVIEW pending user confirmation
                                fu_stmt = select(Task).where(
                                    and_(
                                        Task.contact_id == matched_contact.id,
                                        Task.status.in_([TaskStatus.READY.value, TaskStatus.CREATED.value, TaskStatus.QUEUED.value])
                                    )
                                )
                                pending_tasks = (await session.execute(fu_stmt)).scalars().all()
                                for pt in pending_tasks:
                                    pt.status = TaskStatus.MANUAL_REVIEW.value
                                    pt.manual_review_reason = f"[REPLY_RECEIVED] Automated reply detected: '{inbound_text[:70]}...'. User confirmation required to proceed with follow-up."
                                    pt.updated_at = now

                                logger.info(f"[ReplyScanner] Automated message detected from {matched_contact.name}: Phone={extracted['phone']}, Email={extracted['email']}")
                            else:
                                human_count += 1
                                matched_contact.replied_status = "YES"
                                matched_contact.auto_reply_message = inbound_text
                                matched_contact.extracted_phone = extracted["phone"]
                                matched_contact.extracted_email = extracted["email"]
                                matched_contact.extracted_link = extracted["link"]
                                matched_contact.reply_detected_at = now

                                # Hold pending/ready follow-ups in MANUAL_REVIEW pending user confirmation
                                fu_stmt = select(Task).where(
                                    and_(
                                        Task.contact_id == matched_contact.id,
                                        Task.status.in_([TaskStatus.READY.value, TaskStatus.CREATED.value, TaskStatus.QUEUED.value])
                                    )
                                )
                                pending_tasks = (await session.execute(fu_stmt)).scalars().all()
                                for pt in pending_tasks:
                                    pt.status = TaskStatus.MANUAL_REVIEW.value
                                    pt.manual_review_reason = f"[REPLY_RECEIVED] Human reply detected: '{inbound_text[:70]}...'. User confirmation required to proceed with follow-up."
                                    pt.updated_at = now

                                logger.info(f"[ReplyScanner] Human reply detected from {matched_contact.name}: {inbound_text[:80]}")

                            # Check for external messages sent from our end
                            outbound_msgs = inspect_res.get("data", {}).get("outbound_messages", [])
                            if outbound_msgs:
                                ext_outbounds = [m for m in outbound_msgs if not is_system_sequence_message(m, matched_contact)]
                                if ext_outbounds:
                                    ext_snip = ext_outbounds[-1]
                                    logger.warning(f"[ReplyScanner] External outbound message detected for {matched_contact.name}: '{ext_snip}'")
                                    matched_contact.notes = ((matched_contact.notes or "") + f" [External message: {ext_snip[:50]}]").strip()
                                    fu_stmt = select(Task).where(
                                        and_(
                                            Task.contact_id == matched_contact.id,
                                            Task.status.in_([TaskStatus.READY.value, TaskStatus.QUEUED.value])
                                        )
                                    )
                                    pending_tasks = (await session.execute(fu_stmt)).scalars().all()
                                    for pt in pending_tasks:
                                        pt.status = TaskStatus.MANUAL_REVIEW.value
                                        pt.manual_review_reason = f"[EXTERNAL_MESSAGE_DETECTED] External message sent from our end not in system sequence: '{ext_snip[:70]}...'. Verify in Queue."
                                        pt.updated_at = now
                        else:
                            # Thread snippet indicates no inbound reply, but check if there are pending follow-ups today
                            # Inspect conversation to ensure no external manual message or unread inbound message was missed
                            fu_check_stmt = select(Task).where(
                                and_(
                                    Task.contact_id == matched_contact.id,
                                    Task.status.in_([TaskStatus.READY.value, TaskStatus.QUEUED.value]),
                                    Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"])
                                )
                            )
                            pending_fus = (await session.execute(fu_check_stmt)).scalars().all()
                            if pending_fus and thread_href:
                                try:
                                    inspect_res = await extension_bridge.inspect_thread_reply(thread_href)
                                    if inspect_res.get("success") and inspect_res.get("data"):
                                        idata = inspect_res["data"]
                                        inbound_list = idata.get("inbound_messages", [])
                                        outbound_list = idata.get("outbound_messages", [])
                                        if inbound_list:
                                            # Actually has inbound message
                                            inbound_msg = inbound_list[-1]
                                            matched_contact.replied_status = "YES"
                                            matched_contact.auto_reply_message = inbound_msg
                                            matched_contact.reply_detected_at = now
                                            for pt in pending_fus:
                                                pt.status = TaskStatus.MANUAL_REVIEW.value
                                                pt.manual_review_reason = f"[REPLY_RECEIVED] Inbound message detected: '{inbound_msg[:70]}...'. Review required."
                                                pt.updated_at = now
                                            human_count += 1
                                        elif outbound_list:
                                            ext_out = [m for m in outbound_list if not is_system_sequence_message(m, matched_contact)]
                                            if ext_out:
                                                ext_snip = ext_out[-1]
                                                matched_contact.notes = ((matched_contact.notes or "") + f" [External message: {ext_snip[:50]}]").strip()
                                                for pt in pending_fus:
                                                    pt.status = TaskStatus.MANUAL_REVIEW.value
                                                    pt.manual_review_reason = f"[EXTERNAL_MESSAGE_DETECTED] External message sent from our end not in system sequence: '{ext_snip[:70]}...'. Verify in Queue."
                                                    pt.updated_at = now
                                except Exception as err:
                                    logger.warning(f"[ReplyScanner] Secondary thread check failed for {matched_contact.name}: {err}")

                            # No reply confirmed
                            no_reply += 1
                            if matched_contact.replied_status == "UNKNOWN":
                                matched_contact.replied_status = "NO_REPLY"

                    await session.commit()

                self.current_stage = "COMPLETED"
                self.last_scanned_at = now
                try:
                    from backend.automation.scan_tracker import persist_last_scan
                    self._persisted_scan_at = await persist_last_scan("WORKER-02", now)
                except Exception:
                    pass
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
                if self._periodic_task and not self._periodic_task.done():
                    self.status = "PAUSED" if self._paused else "RUNNING"
                else:
                    self.status = "PAUSED" if self._paused else "IDLE"
                self.current_stage = "IDLE"

reply_scanner_worker = ReplyScannerWorker()
