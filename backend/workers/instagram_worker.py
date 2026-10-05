"""
Instagram Worker: the heart of automation.
Runs sequentially through tasks, controlling the visible Chrome browser.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Task, Contact, Message, Error
from backend.automation.instagram.browser import BrowserWorker
from backend.automation.instagram.instagram_adapter import InstagramAdapter
from backend.automation.instagram.result_detector import ResultDetector
from backend.verification.verification_service import VerificationService
from backend.repositories.task_repository import TaskRepository
from backend.repositories.worker_repository import WorkerRepository, MessageRepository, VerificationRepository
from backend.repositories.event_repository import EventRepository
from backend.database.session import AsyncSessionLocal
from backend.domain.enums import (
    TaskStatus, ResultCode, EventCode, AutomationStage, WorkerStatus, VerificationDecision
)
from backend.config.settings import settings, SCREENSHOTS_DIR
from backend.events.event_bus import event_bus
from backend.automation.extension_bridge import extension_bridge, ExtensionAdapter
from backend.automation.coordinator import coordinator

logger = logging.getLogger(__name__)

WORKER_ID = "WORKER-01"
WORKER_NAME = "Instagram Worker 01"

class InstagramWorker:
    def __init__(self):
        self.browser_worker = BrowserWorker()
        self.status = WorkerStatus.IDLE
        self.stage = AutomationStage.IDLE
        self.instagram_login_status = "UNKNOWN"
        self.current_task_id: Optional[str] = None
        self.current_contact_name: Optional[str] = None
        self.current_instagram: Optional[str] = None
        self.batch_limit: Optional[int] = None
        self.batch_sent_count: int = 0
        self.delay_between_messages: int = 15
        self.current_run_id: Optional[str] = None
        self.run_completed_task_ids: List[str] = []
        self.run_completed_contact_ids: List[str] = []
        self.run_sent_records: List[Dict[str, Any]] = []
        self._paused = False
        self._stop_requested = False
        self.is_dispatching_dm = False
        self._task: Optional[asyncio.Task] = None
        self._start_time: Optional[datetime] = None

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def is_paused(self) -> bool:
        return self._paused

    # ───────────────────────────────────────────────
    # Control methods
    # ───────────────────────────────────────────────

    async def start(self, batch_limit: Optional[int] = None, delay_seconds: Optional[int] = None) -> None:
        if self._paused or self.status == WorkerStatus.PAUSED:
            if batch_limit is not None and batch_limit > 0:
                self.batch_limit = batch_limit
            if delay_seconds is not None and delay_seconds >= 5:
                self.delay_between_messages = delay_seconds
            await self.resume()
            return

        if self._task and self._task.done():
            self._task = None

        if self._task and not self._task.done():
            return

        # Acquire mutual exclusion lock before starting
        await coordinator.acquire_dm_lock(WORKER_ID)

        self.batch_limit = batch_limit if (batch_limit is not None and batch_limit > 0) else None
        self.batch_sent_count = 0
        self.current_run_id = f"run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
        self.run_completed_task_ids = []
        self.run_completed_contact_ids = []
        self.run_sent_records = []
        if delay_seconds is not None and delay_seconds >= 5:
            self.delay_between_messages = delay_seconds
        self._stop_requested = False
        self._paused = False

        # Reset any orphaned tasks claimed by this worker in RUNNING status back to READY
        try:
            async with AsyncSessionLocal() as session:
                task_repo = TaskRepository(session)
                orphaned = await task_repo.list_interrupted()
                for ot in orphaned:
                    if ot.worker_id == WORKER_ID or ot.worker_id is None:
                        await task_repo.update_status(ot.id, TaskStatus.READY, worker_id=None)
        except Exception as e:
            logger.error(f"[Worker] Error recovering interrupted tasks: {e}")

        self._task = asyncio.create_task(self._run_loop())
        logger.info(f"[Worker] {WORKER_NAME} started (batch_limit={self.batch_limit}, delay={self.delay_between_messages}s)")

    async def pause(self) -> None:
        self._paused = True
        self.status = WorkerStatus.PAUSED
        await coordinator.release_dm_lock(WORKER_ID)
        await self._update_worker_db(status="PAUSED")
        await event_bus.publish(EventCode.WORKER_PAUSED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())

    async def resume(self) -> None:
        await coordinator.acquire_dm_lock(WORKER_ID)
        self._stop_requested = False
        self._paused = False
        self.status = WorkerStatus.RUNNING
        if not self._task or self._task.done():
            self._task = asyncio.create_task(self._run_loop())
        await self._update_worker_db(status="RUNNING")
        await event_bus.publish(EventCode.WORKER_RESUMED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())

    async def stop(self) -> None:
        self._stop_requested = True
        self._paused = False
        await coordinator.release_dm_lock(WORKER_ID)
        task_to_cancel = self._task
        self._task = None
        if task_to_cancel and not task_to_cancel.done():
            task_to_cancel.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(task_to_cancel), timeout=2.0)
            except (Exception, asyncio.CancelledError):
                pass

        # Reset current task back to READY if it was RUNNING so it can be resumed cleanly later
        if self.current_task_id:
            try:
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    current_task = await task_repo.get_by_id(self.current_task_id)
                    if current_task and current_task.status == TaskStatus.RUNNING.value:
                        await task_repo.update_status(self.current_task_id, TaskStatus.READY, worker_id=None)
            except Exception as e:
                logger.error(f"[Worker] Error releasing task {self.current_task_id} on stop: {e}")
            self.current_task_id = None

        try:
            await self.browser_worker.stop()
        except Exception:
            pass
        self.status = WorkerStatus.STOPPED
        self.stage = AutomationStage.IDLE
        await self._update_worker_db(status="STOPPED", browser_status="DISCONNECTED", current_stage="IDLE")
        await event_bus.publish(EventCode.WORKER_STOPPED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())
        logger.info(f"[Worker] {WORKER_NAME} stopped")

    # ───────────────────────────────────────────────
    # Health / state
    # ───────────────────────────────────────────────

    async def health(self) -> Dict[str, Any]:
        from backend.automation.extension_bridge import extension_bridge
        if extension_bridge.is_connected:
            browser_status = "CONNECTED (Chrome Extension)"
        else:
            bh = await self.browser_worker.health()
            browser_status = bh.get("status", "DISCONNECTED")
        return {
            "worker_id": WORKER_ID,
            "worker_name": WORKER_NAME,
            "status": self.status.value,
            "stage": self.stage.value,
            "browser_status": browser_status,
            "instagram_login_status": self.instagram_login_status,
            "current_task_id": self.current_task_id,
            "current_contact_name": self.current_contact_name,
            "current_instagram": self.current_instagram,
            "batch_limit": self.batch_limit,
            "batch_sent_count": self.batch_sent_count,
            "current_run_id": self.current_run_id,
            "run_completed_task_ids": self.run_completed_task_ids,
            "run_completed_contact_ids": self.run_completed_contact_ids,
            "run_sent_records": self.run_sent_records,
            "delay_seconds": self.delay_between_messages,
            "elapsed_seconds": (datetime.now(timezone.utc) - self._start_time).seconds if self._start_time else 0
        }

    # ───────────────────────────────────────────────
    # Internal helpers
    # ───────────────────────────────────────────────

    async def _update_worker_db(self, **kwargs) -> None:
        async with AsyncSessionLocal() as session:
            repo = WorkerRepository(session)
            await repo.get_or_create(WORKER_ID, WORKER_NAME)
            await repo.update_status(WORKER_ID, **kwargs)

    async def _set_stage(self, stage: AutomationStage, contact_name: Optional[str] = None,
                         instagram: Optional[str] = None, task_id: Optional[str] = None) -> None:
        self.stage = stage
        if contact_name:
            self.current_contact_name = contact_name
        if instagram:
            self.current_instagram = instagram
        if task_id:
            self.current_task_id = task_id
        await self._update_worker_db(
            current_stage=stage.value,
            current_task_id=self.current_task_id,
            current_contact_id=None,
            status=self.status.value
        )
        await event_bus.publish(
            EventCode.STAGE_CHANGED,
            payload={"stage": stage.value},
            stage=stage.value,
            worker_id=WORKER_ID,
            task_id=self.current_task_id,
            contact_name=self.current_contact_name
        )
        await event_bus.publish_state(await self.health())

    # ───────────────────────────────────────────────
    # Main loop
    # ───────────────────────────────────────────────

    async def _run_loop(self) -> None:
        self.status = WorkerStatus.RUNNING
        self._start_time = datetime.now(timezone.utc)

        try:
            from backend.automation.extension_bridge import extension_bridge, ExtensionAdapter

            # Prioritize Chrome Extension Bridge so automation runs inside your real Chrome window
            if not extension_bridge.is_connected:
                for _ in range(6):
                    if extension_bridge.is_connected:
                        break
                    await asyncio.sleep(0.5)

            if extension_bridge.is_connected:
                logger.info("[Worker] Active Chrome Extension connected! Driving automation directly inside your live window.")
                await self._update_worker_db(status="RUNNING", browser_status="CONNECTED (Chrome Extension)")
                await event_bus.publish(EventCode.WORKER_STARTED, worker_id=WORKER_ID)
                await event_bus.publish_state(await self.health())

                adapter = ExtensionAdapter(extension_bridge)
                await self._set_stage(AutomationStage.CHECKING_LOGIN)
                await self._check_login_loop(adapter)
            else:
                logger.info("[Worker] Waiting for Chrome Extension to connect from your open Chrome window...")
                self.stage = AutomationStage.CHECKING_LOGIN
                self.instagram_login_status = "EXTENSION_REQUIRED"
                await self._update_worker_db(status="RUNNING", browser_status="WAITING_FOR_EXTENSION", current_stage="CHECKING_LOGIN")
                await event_bus.publish_state(await self.health())

                while not extension_bridge.is_connected and not self._stop_requested:
                    await asyncio.sleep(1)

                if self._stop_requested:
                    return

                logger.info("[Worker] Chrome Extension connected! Resuming automation in your active window.")
                adapter = ExtensionAdapter(extension_bridge)
                await self._set_stage(AutomationStage.CHECKING_LOGIN)
                await self._check_login_loop(adapter)

            # Task processing loop
            while not self._stop_requested:
                if self._paused:
                    await asyncio.sleep(1)
                    continue

                # Batch limit guard: auto-pause when batch target reached
                if self.batch_limit is not None and self.batch_sent_count >= self.batch_limit:
                    logger.info(f"[Worker] Batch limit of {self.batch_limit} reached ({self.batch_sent_count} sent). Automation safely paused.")
                    self._paused = True
                    self.status = WorkerStatus.PAUSED
                    self.stage = AutomationStage.IDLE
                    await self._update_worker_db(status="PAUSED", current_stage="IDLE")
                    await event_bus.publish(
                        EventCode.WORKER_PAUSED,
                        worker_id=WORKER_ID,
                        payload={"reason": f"Batch limit reached ({self.batch_sent_count}/{self.batch_limit} sent)"}
                    )
                    await event_bus.publish_state(await self.health())
                    while self._paused and not self._stop_requested:
                        await asyncio.sleep(1)
                    if self._stop_requested:
                        break

                # Guard: Ensure browser is connected and page is alive
                if not extension_bridge.is_connected and (not self.browser_worker.is_running or not self.browser_worker.page or self.browser_worker.page.is_closed()):
                    logger.warning("[Worker] Browser closed or disconnected. Halting task loop.")
                    break

                task = await self._claim_next_task()
                if not task:
                    # Check if there are any READY tasks left in the queue or scheduled in future
                    async with AsyncSessionLocal() as session:
                        repo = TaskRepository(session)
                        counts = await repo.count_by_status()
                        ready_count = counts.get("READY", 0)

                        now = datetime.now(timezone.utc)
                        future_stmt = select(func.min(Task.scheduled_at)).where(
                            and_(Task.status == TaskStatus.READY.value, Task.scheduled_at > now)
                        )
                        next_due = (await session.execute(future_stmt)).scalar_one_or_none()

                    if ready_count == 0 or (ready_count > 0 and next_due is not None):
                        msg = (
                            f"Outreach batch completed! All currently due contacts have been messaged. "
                            f"Next follow-up is scheduled for {next_due.strftime('%b %d, %Y, %I:%M %p UTC') if next_due else 'N/A'}."
                        ) if next_due else "All contacts and follow-ups in the queue have been completed!"
                        logger.info(f"[Worker] {msg}")
                        self.status = WorkerStatus.IDLE
                        self.stage = AutomationStage.COMPLETED
                        self.last_event = msg
                        await self._update_worker_db(status="IDLE", current_stage="COMPLETED")
                        await event_bus.publish(
                            EventCode.WORKER_COMPLETED,
                            worker_id=WORKER_ID,
                            payload={"message": msg, "next_due": next_due.isoformat() if next_due else None}
                        )
                        await event_bus.publish_state(await self.health())
                        break
                    else:
                        await asyncio.sleep(5)
                        continue

                contact = task.contact
                self.current_task_id = task.id
                self.current_contact_name = contact.name if contact else "Unknown"
                try:
                    self.is_dispatching_dm = True
                    await self._process_task(task, adapter)
                finally:
                    self.is_dispatching_dm = False

                # Batch limit check immediately after task completes
                if self.batch_limit is not None and self.batch_sent_count >= self.batch_limit:
                    logger.info(f"[Worker] Batch limit reached: {self.batch_sent_count}/{self.batch_limit}. Auto-pausing.")
                    self._paused = True
                    self.status = WorkerStatus.PAUSED
                    self.stage = AutomationStage.IDLE
                    await self._update_worker_db(status="PAUSED", current_stage="IDLE")
                    await event_bus.publish(
                        EventCode.WORKER_PAUSED,
                        worker_id=WORKER_ID,
                        payload={"reason": f"Batch limit reached ({self.batch_sent_count}/{self.batch_limit} sent)"}
                    )
                    await event_bus.publish_state(await self.health())
                    continue

                # Pacing delay between contacts to protect Instagram account from rate-limiting
                delay = self.delay_between_messages
                logger.info(f"[Worker] Pacing delay: waiting {delay}s before next contact...")
                for _ in range(delay):
                    while self._paused and not self._stop_requested:
                        await asyncio.sleep(1)
                    if self._stop_requested:
                        break
                    await asyncio.sleep(1)

        except asyncio.CancelledError:
            logger.info("[Worker] Task loop cancelled")
        except Exception as e:
            logger.exception(f"[Worker] Fatal error: {e}")
            self.status = WorkerStatus.ERROR
            await self._update_worker_db(status="ERROR")
            await event_bus.publish_state(await self.health())
        finally:
            self.status = WorkerStatus.STOPPED
            self.stage = AutomationStage.IDLE
            await self._update_worker_db(status="STOPPED", current_stage="IDLE")
            await event_bus.publish_state(await self.health())

    async def _check_login_loop(self, adapter: InstagramAdapter) -> None:
        first_call = True
        while True:
            if self._stop_requested:
                return

            if first_call:
                if not extension_bridge.is_connected:
                    try:
                        from backend.automation.chrome_profile_manager import chrome_profile_manager
                        chrome_profile_manager.bring_chrome_to_front()
                        if adapter.page and not adapter.page.is_closed():
                            await adapter.page.bring_to_front()
                    except Exception:
                        pass
                first_call = False

            is_logged_in, requires_login, has_challenge, reason = await adapter.check_login()

            if is_logged_in:
                logger.info("[Worker] Instagram session verified active! Unblocking automation queue.")
                self.instagram_login_status = "LOGGED_IN"
                self.stage = AutomationStage.IDLE
                await self._update_worker_db(instagram_login_status="LOGGED_IN", current_stage="IDLE")
                await event_bus.publish(EventCode.LOGIN_DETECTED, worker_id=WORKER_ID)
                await event_bus.publish_state(await self.health())
                return

            if has_challenge:
                logger.warning("[Worker] Instagram challenge/2FA detected — waiting for user completion in Chrome window on screen")
                self.instagram_login_status = "CHALLENGE"
                self.stage = AutomationStage.CHECKING_LOGIN
                await self._update_worker_db(instagram_login_status="CHALLENGE", current_stage="CHECKING_LOGIN")
                await event_bus.publish(
                    EventCode.MANUAL_REVIEW_REQUIRED,
                    payload={"reason": "Instagram challenge/2FA required. Please complete verification in the Chrome browser on your screen."},
                    worker_id=WORKER_ID
                )
                await event_bus.publish_state(await self.health())
                await asyncio.sleep(3)
                continue

            # Default: requires_login is True or session is not active
            logger.warning("[Worker] Instagram NOT logged in — BLOCKED. Waiting for user to log in via the Chrome browser window on screen.")
            self.instagram_login_status = "LOGIN_REQUIRED"
            self.stage = AutomationStage.CHECKING_LOGIN
            await self._update_worker_db(instagram_login_status="LOGIN_REQUIRED", current_stage="CHECKING_LOGIN")
            await event_bus.publish(
                EventCode.LOGIN_REQUIRED,
                payload={"reason": "Instagram login required. Automation is blocked and will automatically proceed once you log in via the open Chrome window."},
                worker_id=WORKER_ID
            )
            await event_bus.publish_state(await self.health())
            await asyncio.sleep(3)

    async def _claim_next_task(self):
        async with AsyncSessionLocal() as session:
            repo = TaskRepository(session)
            # Reclaim any task stuck in RUNNING from this worker
            stmt = select(Task).where(and_(Task.status == TaskStatus.RUNNING.value, Task.worker_id == WORKER_ID))
            stuck_tasks = (await session.execute(stmt)).scalars().all()
            for st in stuck_tasks:
                st.status = TaskStatus.READY.value
                st.worker_id = None
            if stuck_tasks:
                await session.commit()
            return await repo.claim_next_ready(WORKER_ID, task_types=["MESSAGE"])

    async def _process_task(self, task, adapter: InstagramAdapter) -> None:
        task_id = task.id

        # Verify task and contact still exist in DB (in case user deleted it)
        async with AsyncSessionLocal() as session:
            t_repo = TaskRepository(session)
            db_task = await t_repo.get_by_id(task_id)
            if not db_task or not db_task.contact:
                logger.info(f"[Worker] Task {task_id} or contact was deleted by user. Skipping to next task.")
                self.current_task_id = None
                return
            contact = db_task.contact

        correlation_id = task_id
        message_body = contact.message or settings.DEFAULT_MESSAGE

        async def take_shot(label: str) -> Optional[str]:
            if hasattr(adapter, "screenshot"):
                shot = await adapter.screenshot(label)
                if shot:
                    return shot
            return await self.browser_worker.screenshot(label)

        try:
            if not extension_bridge.is_connected:
                # Ensure active page is refreshed and synchronized
                active_page = await self.browser_worker.get_active_instagram_page(prefer_target_url=contact.instagram_url)
                if active_page and not active_page.is_closed():
                    self.browser_worker.page = active_page
                    adapter.page = active_page
                    try:
                        await adapter.page.bring_to_front()
                    except Exception:
                        pass

            # Pause & Stop Check
            while self._paused and not self._stop_requested:
                await asyncio.sleep(1)
            if self._stop_requested:
                await self._fail_task(task_id, ResultCode.TASK_CANCELLED, "Worker stopped", new_status=TaskStatus.READY)
                return

            # ── Open Profile ──────────────────────────────────
            await self._set_stage(AutomationStage.OPENING_PROFILE, contact.name, contact.instagram_url, task_id)
            await event_bus.publish(EventCode.TASK_STARTED, task_id=task_id, contact_name=contact.name,
                                    worker_id=WORKER_ID, payload={"instagram_url": contact.instagram_url})

            success, result_code, reason = await adapter.open_profile(contact.instagram_url)
            await take_shot("profile_opened")

            if not success:
                if result_code in {ResultCode.LOGIN_REQUIRED, ResultCode.CHALLENGE_REQUIRED}:
                    is_logged_in, requires_login, _, _ = await adapter.check_login()
                    if not is_logged_in:
                        logger.warning(f"[Worker] Task {task_id} paused: Instagram login required. Resetting task to READY and entering login wait gate.")
                        async with AsyncSessionLocal() as session:
                            repo = TaskRepository(session)
                            await repo.update_status(task_id, TaskStatus.READY, worker_id=None)
                        await self._set_stage(AutomationStage.CHECKING_LOGIN, contact.name, task_id=task_id)
                        await self._check_login_loop(adapter)
                        return
                    else:
                        logger.info(f"[Worker] Task {task_id} open_profile transient glitch while user in another tab. Skipping cleanly without pausing.")

                if "target page, context or browser has been closed" in str(reason).lower():
                    logger.warning("[Worker] Browser closed/disconnected during open_profile. Halting worker loop.")
                    self._stop_requested = True
                    self.status = WorkerStatus.STOPPED
                await self._fail_task(task_id, result_code, reason)
                return

            # Pause & Stop Check
            while self._paused and not self._stop_requested:
                await asyncio.sleep(1)
            if self._stop_requested:
                await self._fail_task(task_id, ResultCode.TASK_CANCELLED, "Worker stopped", new_status=TaskStatus.READY)
                return

            # ── Extract Profile ───────────────────────────────
            await self._set_stage(AutomationStage.EXTRACTING_PROFILE, contact.name, task_id=task_id)
            extracted = await adapter.extract_profile()

            # ── Verify ───────────────────────────────────────
            await self._set_stage(AutomationStage.VERIFYING, contact.name, task_id=task_id)
            await event_bus.publish(EventCode.VERIFICATION_STARTED, task_id=task_id, worker_id=WORKER_ID)

            verifier = VerificationService()
            expected = {
                "instagram_url": contact.instagram_url,
                "username": contact.username,
                "name": contact.name,
                "expected_followers": contact.expected_followers
            }
            verification = await verifier.decide(expected, extracted)

            # Record verification
            async with AsyncSessionLocal() as session:
                vrf_repo = VerificationRepository(session)
                screenshot_url = await take_shot("verification_completed")
                await vrf_repo.record_result(
                    task_id=task_id,
                    contact_id=contact.id,
                    confidence=verification.confidence,
                    decision=verification.decision.value,
                    signals=[s.dict() for s in verification.signals],
                    screenshot_path=screenshot_url,
                    reason=verification.reason
                )

            await event_bus.publish(EventCode.VERIFICATION_COMPLETED, task_id=task_id, worker_id=WORKER_ID,
                                    payload={"confidence": verification.confidence, "decision": verification.decision.value})

            # Check confidence threshold
            if verification.decision == VerificationDecision.MISMATCH:
                await self._fail_task(task_id, ResultCode.PROFILE_MISMATCH, verification.reason,
                                      new_status=TaskStatus.MANUAL_REVIEW, retryable=False)
                return

            if verification.decision == VerificationDecision.LOW_CONFIDENCE:
                await self._fail_task(task_id, ResultCode.PROFILE_MISMATCH, "Low verification confidence",
                                      new_status=TaskStatus.MANUAL_REVIEW, retryable=False)
                return

            # ── Check DM Availability ─────────────────────────
            await self._set_stage(AutomationStage.CHECKING_DM_AVAILABILITY, contact.name, task_id=task_id)
            dm_available, dm_code, dm_reason = await adapter.check_message_availability()

            if not dm_available:
                await self._fail_task(task_id, dm_code, dm_reason,
                                      new_status=TaskStatus.SKIPPED, retryable=False)
                await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, worker_id=WORKER_ID,
                                        payload={"reason": dm_reason, "code": dm_code.value})
                return

            # ── Prepare Message ───────────────────────────────
            await self._set_stage(AutomationStage.OPENING_COMPOSER, contact.name, task_id=task_id)
            prep_res = await adapter.prepare_message(message_body)
            prepared = prep_res[0]
            prep_reason = prep_res[-1]
            screenshot_url = await take_shot("message_composer_opened")

            if not prepared:
                await self._fail_task(task_id, ResultCode.SEND_FAILED, prep_reason, retryable=True)
                return

            # Check if task or contact was deleted while in progress
            async with AsyncSessionLocal() as session:
                t_repo = TaskRepository(session)
                db_task = await t_repo.get_by_id(task_id)
                if not db_task or not db_task.contact:
                    logger.info(f"[Worker] Task {task_id} was deleted by user before sending. Skipping cleanly.")
                    self.current_task_id = None
                    return

            # Anti-duplicate DB guard: check if contact was already messaged
            async with AsyncSessionLocal() as session:
                msg_repo = MessageRepository(session)
                existing_msgs = await msg_repo.list_by_contact(contact.id)
                sent_msgs = [m for m in existing_msgs if m.status == "SENT"]
                if sent_msgs and task.type == "MESSAGE":
                    logger.info(f"[Worker] Contact {contact.name} already has {len(sent_msgs)} SENT message(s) in DB. Marking task COMPLETED to prevent duplicate send.")
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.COMPLETED)
                    self.current_task_id = None
                    return

            # Create message record
            async with AsyncSessionLocal() as session:
                msg_repo = MessageRepository(session)
                msg = await msg_repo.create(contact.id, task_id, message_body)
                msg_id = msg.id

            # Pause & Stop Check right before sending
            while self._paused and not self._stop_requested:
                await asyncio.sleep(1)
            if self._stop_requested:
                await self._fail_task(task_id, ResultCode.TASK_CANCELLED, "Worker stopped", new_status=TaskStatus.READY)
                return

            # Re-verify latest contact state & reply status before initiating send
            async with AsyncSessionLocal() as chk_session:
                chk_c = await chk_session.get(Contact, contact.id)
                if chk_c and chk_c.replied_status in ["YES", "AUTOMATED_MESSAGE"]:
                    logger.info(f"[Worker] Contact {contact.name} already replied ({chk_c.replied_status}). Aborting send.")
                    t_repo = TaskRepository(chk_session)
                    await t_repo.update_status(task_id, TaskStatus.CANCELLED, manual_review_reason=f"Cancelled: Contact replied {chk_c.replied_status}")
                    self.current_task_id = None
                    return
                if chk_c and chk_c.message:
                    message_body = chk_c.message

            # ── Send Message ──────────────────────────────────
            await self._set_stage(AutomationStage.SENDING_MESSAGE, contact.name, task_id=task_id)
            await event_bus.publish(EventCode.MESSAGE_ATTEMPTED, task_id=task_id, worker_id=WORKER_ID,
                                    payload={"body": message_body})

            check_history = (task.type == "MESSAGE")
            if isinstance(adapter, ExtensionAdapter):
                sent, send_reason, already_messaged, dm_restricted = await adapter.send_message(check_history=check_history, task_type=task.type)
            else:
                sent, send_reason = await adapter.send_message()
                already_messaged = False
                dm_restricted = False

            await take_shot("message_attempted")

            if dm_restricted:
                logger.warning(f"[Worker] Contact {contact.name} has DM restrictions: {send_reason}. Marking DM_RESTRICTED and skipping.")
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.SKIPPED)
                    contact_repo = ContactRepository(session)
                    await contact_repo.update(contact.id, {
                        "replied_status": "DM_RESTRICTED",
                        "auto_reply_message": send_reason,
                        "notes": f"Instagram DM Restricted: {send_reason}"
                    })
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "SKIPPED", "DM_RESTRICTED")
                await event_bus.publish(
                    EventCode.TASK_SKIPPED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    payload={"reason": send_reason, "code": "DM_RESTRICTED"}
                )
                self.current_task_id = None
                return

            if already_messaged:
                logger.warning(f"[Worker] Contact {contact.name} already has prior conversation history on Instagram! Skipping initial outreach.")
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.SKIPPED)
                    contact_repo = ContactRepository(session)
                    await contact_repo.update(contact.id, {"replied_status": "EXISTING_HISTORY", "notes": "Existing Instagram DM history detected"})
                    # Delete the pending message record created for this skipped attempt
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "SKIPPED", "ALREADY_MESSAGED")
                await event_bus.publish(
                    EventCode.TASK_SKIPPED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    payload={"reason": "Existing conversation history detected on Instagram", "code": "ALREADY_MESSAGED"}
                )
                self.current_task_id = None
                return

            # ── Detect Result ─────────────────────────────────
            await self._set_stage(AutomationStage.DETECTING_RESULT, contact.name, task_id=task_id)
            result = await adapter.detect_result(message_body)
            await take_shot("message_result")

            if result == ResultCode.SUCCESS:
                self.batch_sent_count += 1
                if self.current_run_id:
                    self.run_completed_task_ids.append(task_id)
                    self.run_completed_contact_ids.append(contact.id)
                    self.run_sent_records.append({
                        "task_id": task_id,
                        "contact_id": contact.id,
                        "contact_name": contact.name,
                        "username": contact.username,
                        "action": task.type,
                        "run_id": self.current_run_id,
                        "completed_at": datetime.now(timezone.utc).isoformat()
                    })

                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "SENT", "SUCCESS")
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.COMPLETED, run_id=self.current_run_id)

                    chk_c = await session.get(Contact, contact.id)
                    if chk_c and self.current_run_id:
                        chk_c.last_run_id = self.current_run_id

                    # Automatically schedule Follow-Up 1 or 2 if contact has not replied
                    if contact.replied_status not in ["YES", "AUTOMATED_MESSAGE"]:
                        from datetime import timedelta
                        now = datetime.now(timezone.utc)
                        if task.type == "MESSAGE":
                            delay = contact.followup_1_delay_days or 3
                            fu_stmt = select(Task).where(
                                and_(Task.contact_id == contact.id, Task.type == "FOLLOW_UP_1")
                            )
                            existing_fu = (await session.execute(fu_stmt)).scalar_one_or_none()
                            if not existing_fu:
                                fu1_task = Task(
                                    contact_id=contact.id,
                                    type="FOLLOW_UP_1",
                                    sequence=2,
                                    priority=task.priority,
                                    scheduled_at=now + timedelta(days=delay),
                                    status=TaskStatus.READY.value
                                )
                                session.add(fu1_task)
                                await session.commit()
                                logger.info(f"[Worker] Scheduled Follow-up 1 for {contact.name} in {delay} days")
                        elif task.type == "FOLLOW_UP_1":
                            delay = contact.followup_2_delay_days or 5
                            fu_stmt = select(Task).where(
                                and_(Task.contact_id == contact.id, Task.type == "FOLLOW_UP_2")
                            )
                            existing_fu = (await session.execute(fu_stmt)).scalar_one_or_none()
                            if not existing_fu:
                                fu2_task = Task(
                                    contact_id=contact.id,
                                    type="FOLLOW_UP_2",
                                    sequence=3,
                                    priority=task.priority,
                                    scheduled_at=now + timedelta(days=delay),
                                    status=TaskStatus.READY.value
                                )
                                session.add(fu2_task)
                                await session.commit()
                                logger.info(f"[Worker] Scheduled Follow-up 2 for {contact.name} in {delay} days")

                    # Record OutreachHistory entry to retain long-term memory
                    try:
                        from backend.database.models import OutreachHistory
                        history_entry = OutreachHistory(
                            username=contact.username,
                            instagram_url=contact.instagram_url,
                            contact_name=contact.name,
                            action="MESSAGED" if task.type == "MESSAGE" else task.type,
                            details=f"Sent {task.type} successfully",
                            run_id=self.current_run_id
                        )
                        session.add(history_entry)
                        await session.commit()
                    except Exception as e:
                        logger.warning(f"[Worker 1] Could not record outreach history: {e}")

                await event_bus.publish(
                    EventCode.MESSAGE_CONFIRMED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    contact_name=contact.name,
                    payload={"result": "SUCCESS", "batch_sent": self.batch_sent_count, "batch_limit": self.batch_limit}
                )
                await event_bus.publish(EventCode.TASK_COMPLETED, task_id=task_id, worker_id=WORKER_ID)
                logger.info(f"[Worker] Task {task_id} COMPLETED — {contact.name} (Batch: {self.batch_sent_count}/{self.batch_limit or 'All'})")

            elif result == ResultCode.RATE_LIMITED:
                # INSTAGRAM RATE LIMIT / ACTION BLOCK DETECTED -> PAUSE IMMEDIATELY
                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "FAILED", "RATE_LIMITED")
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW)
                self._paused = True
                self.status = WorkerStatus.PAUSED
                await self._update_worker_db(status="PAUSED")
                await event_bus.publish(
                    EventCode.MANUAL_REVIEW_REQUIRED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    payload={"reason": "Instagram action block or rate limit detected. Automation paused for safety."}
                )
                logger.warning(f"[Worker] Instagram rate limit / action block detected on task {task_id}. Worker paused.")

            elif result == ResultCode.UNKNOWN:
                # FAIL CLOSED: unknown = reconcile first
                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "UNKNOWN", "UNKNOWN")
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.RECONCILING)
                await event_bus.publish(EventCode.MANUAL_REVIEW_REQUIRED, task_id=task_id, worker_id=WORKER_ID,
                                        payload={"reason": "Unknown send result — reconcile before retry"})
                logger.warning(f"[Worker] Task {task_id} UNKNOWN_RESULT — moved to RECONCILING")

            else:
                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "FAILED", result.value)
                is_retryable = ResultDetector.is_retryable(result)
                new_status = TaskStatus.RETRY_WAIT if is_retryable else TaskStatus.MANUAL_REVIEW
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    current_task = await task_repo.get_by_id(task_id)
                    if current_task and current_task.status == TaskStatus.RUNNING.value:
                        await task_repo.update_status(task_id, new_status)
                await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, worker_id=WORKER_ID,
                                        payload={"result": result.value, "retryable": is_retryable})

        except Exception as e:
            logger.exception(f"[Worker] Error processing task {task_id}: {e}")
            await take_shot("error")
            try:
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    current_task = await task_repo.get_by_id(task_id)
                    if current_task and current_task.status == TaskStatus.RUNNING.value:
                        await task_repo.update_status(task_id, TaskStatus.RETRY_WAIT)
            except Exception as db_err:
                logger.error(f"[Worker] Failed to update task status after error: {db_err}")
            await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, worker_id=WORKER_ID,
                                    payload={"error": str(e)})

        # Brief pause between tasks
        await asyncio.sleep(1)

    async def _fail_task(self, task_id: str, result_code: ResultCode, reason: str,
                         new_status: TaskStatus = TaskStatus.RETRY_WAIT, retryable: bool = True) -> None:
        async with AsyncSessionLocal() as session:
            task_repo = TaskRepository(session)
            current_task = await task_repo.get_by_id(task_id)
            if current_task and current_task.status == TaskStatus.RUNNING.value:
                await task_repo.update_status(task_id, new_status)
        await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, worker_id=WORKER_ID,
                                payload={"code": result_code.value, "reason": reason, "retryable": retryable})
        logger.warning(f"[Worker] Task {task_id} failed: {result_code.value} — {reason}")


# Singleton worker instance
instagram_worker = InstagramWorker()
