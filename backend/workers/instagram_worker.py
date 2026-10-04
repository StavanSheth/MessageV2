"""
Instagram Worker: authoritative execution engine.
Enforces strict task lifecycle:
READY -> RUNNING -> VERIFYING -> [AWAITING_APPROVAL -> APPROVED] -> SENDING -> COMPLETED
With safe recovery, lease heartbeating, conversation reconciliation, and idempotency.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Task, Contact, Message
from backend.automation.instagram.browser import BrowserWorker
from backend.automation.instagram.instagram_adapter import InstagramAdapter
from backend.automation.retry.policy import RetryPolicy
from backend.verification.verification_service import VerificationService
from backend.recovery.recovery_service import RecoveryService
from backend.followups.service import FollowUpService
from backend.repositories.task_repository import TaskRepository
from backend.repositories.worker_repository import WorkerRepository, MessageRepository, VerificationRepository
from backend.repositories.event_repository import EventRepository
from backend.database.session import AsyncSessionLocal
from backend.domain.enums import (
    TaskStatus, ResultCode, EventCode, AutomationStage, WorkerStatus, VerificationDecision
)
from backend.config.settings import settings
from backend.events.event_bus import event_bus
from backend.network.network_monitor import network_monitor
from backend.services.source_sync_service import SourceSyncService

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
        self._paused = False
        self._stop_requested = False
        self._task: Optional[asyncio.Task] = None
        self._start_time: Optional[datetime] = None

    # ───────────────────────────────────────────────
    # Control methods
    # ───────────────────────────────────────────────

    async def start(self, batch_limit: Optional[int] = None, delay_seconds: Optional[int] = None) -> None:
        if self._task and not self._task.done():
            if self._paused:
                self.batch_limit = batch_limit if (batch_limit is not None and batch_limit > 0) else None
                self.batch_sent_count = 0
                if delay_seconds is not None and delay_seconds >= 5:
                    self.delay_between_messages = delay_seconds
                await self.resume()
            return
        self.batch_limit = batch_limit if (batch_limit is not None and batch_limit > 0) else None
        self.batch_sent_count = 0
        if delay_seconds is not None and delay_seconds >= 5:
            self.delay_between_messages = delay_seconds
        self._stop_requested = False
        self._paused = False
        self._task = asyncio.create_task(self._run_loop())
        logger.info(f"[Worker] {WORKER_NAME} started (batch_limit={self.batch_limit}, delay={self.delay_between_messages}s)")

    async def pause(self) -> None:
        self._paused = True
        self.status = WorkerStatus.PAUSED
        await self._update_worker_db(status="PAUSED")
        await event_bus.publish(EventCode.WORKER_PAUSED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())

    async def resume(self) -> None:
        self._paused = False
        self.status = WorkerStatus.RUNNING
        await self._update_worker_db(status="RUNNING")
        await event_bus.publish(EventCode.WORKER_RESUMED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())

    async def stop(self) -> None:
        self._stop_requested = True
        self._paused = False
        if self._task and not self._task.done():
            self._task.cancel()
        try:
            await self.browser_worker.stop()
        except Exception:
            pass
        self.status = WorkerStatus.STOPPED
        await self._update_worker_db(status="STOPPED", browser_status="DISCONNECTED", current_stage="IDLE")
        await event_bus.publish(EventCode.WORKER_STOPPED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())
        logger.info(f"[Worker] {WORKER_NAME} stopped")

    # ───────────────────────────────────────────────
    # Health / state
    # ───────────────────────────────────────────────

    async def health(self) -> Dict[str, Any]:
        bh = await self.browser_worker.health()
        return {
            "worker_id": WORKER_ID,
            "worker_name": WORKER_NAME,
            "status": self.status.value,
            "stage": self.stage.value,
            "browser_status": bh.get("status", "DISCONNECTED"),
            "instagram_login_status": self.instagram_login_status,
            "current_task_id": self.current_task_id,
            "current_contact_name": self.current_contact_name,
            "current_instagram": self.current_instagram,
            "batch_limit": self.batch_limit,
            "batch_sent_count": self.batch_sent_count,
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
            # 1. Startup Recovery: Reconcile any interrupted tasks from previous sessions
            async with AsyncSessionLocal() as session:
                recovery = RecoveryService(session)
                recovery_res = await recovery.reconcile_on_startup()
                logger.info(f"[Worker] Startup recovery complete: {recovery_res}")

            # 2. Initialize browser
            await self._set_stage(AutomationStage.INITIALIZING)
            page = await self.browser_worker.start()
            await self._update_worker_db(status="RUNNING", browser_status="CONNECTED")
            await event_bus.publish(EventCode.WORKER_STARTED, worker_id=WORKER_ID)
            await event_bus.publish_state(await self.health())

            # 3. Instagram login check
            await self._set_stage(AutomationStage.CHECKING_LOGIN)
            adapter = InstagramAdapter(page)
            await self._check_login_loop(adapter)

            # 4. Task processing loop
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

                # Guard 1: Network state check before taking next action
                if not network_monitor.is_online():
                    logger.warning(f"[Worker] Network is {network_monitor.state.value}. Pausing actions until connectivity restored...")
                    await self._update_worker_db(browser_status=network_monitor.state.value)
                    await event_bus.publish(EventCode.NETWORK_OFFLINE, worker_id=WORKER_ID, payload={"state": network_monitor.state.value})
                    restored = await network_monitor.wait_for_connectivity(max_wait_seconds=20.0)
                    if not restored:
                        await asyncio.sleep(5)
                        continue
                    await event_bus.publish(EventCode.NETWORK_RECOVERED, worker_id=WORKER_ID)

                # Guard 2: Autonomous browser recovery if closed or disconnected
                if not self.browser_worker.is_running or not self.browser_worker.page or self.browser_worker.page.is_closed():
                    logger.warning("[Worker] Browser closed or disconnected. Triggering autonomous recovery...")
                    await self._update_worker_db(browser_status="RECOVERING")
                    await event_bus.publish(EventCode.BROWSER_CRASH, task_id=self.current_task_id, worker_id=WORKER_ID)

                    # Reconcile active task if any was running
                    if self.current_task_id:
                        async with AsyncSessionLocal() as session:
                            rec = RecoveryService(session)
                            await rec.handle_browser_crash(self.current_task_id)
                        self.current_task_id = None
                        self.current_contact_name = None
                        self.current_instagram = None

                    # Autonomous recovery: restart Chrome and reconnect Playwright
                    recovery_attempts = 0
                    max_recovery_attempts = 3
                    recovered = False
                    while recovery_attempts < max_recovery_attempts and not self._stop_requested:
                        recovery_attempts += 1
                        try:
                            logger.info(f"[Worker] Autonomous browser recovery attempt {recovery_attempts}/{max_recovery_attempts}...")
                            new_page = await self.browser_worker.restart()
                            if new_page and not new_page.is_closed():
                                adapter.page = new_page
                                await self._update_worker_db(browser_status="CONNECTED")
                                await event_bus.publish(EventCode.BROWSER_RECOVERED, worker_id=WORKER_ID)
                                # Verify Instagram login session after restart
                                await self._check_login_loop(adapter)
                                recovered = True
                                break
                        except Exception as rec_err:
                            logger.error(f"[Worker] Browser recovery attempt {recovery_attempts} failed: {rec_err}")
                            await asyncio.sleep(2)

                    if not recovered:
                        logger.error("[Worker] Autonomous browser recovery failed after max attempts.")
                        break
                    continue

                task = await self._claim_next_task()
                if not task:
                    async with AsyncSessionLocal() as session:
                        repo = TaskRepository(session)
                        counts = await repo.count_by_status()
                        ready_count = counts.get("READY", 0)
                    if ready_count == 0:
                        logger.info("[Worker] All ready tasks in the queue have been processed.")
                        self.status = WorkerStatus.IDLE
                        self.stage = AutomationStage.COMPLETED
                        await self._update_worker_db(status="IDLE", current_stage="COMPLETED")
                        await event_bus.publish_state(await self.health())
                        break
                    else:
                        await asyncio.sleep(5)
                        continue

                contact = task.contact
                self.current_task_id = task.id
                self.current_contact_name = contact.name if contact else "Unknown"
                self.current_instagram = contact.instagram_url if contact else ""

                await self._process_task(task, adapter)

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

                # Pacing delay between contacts
                delay = self.delay_between_messages
                logger.info(f"[Worker] Pacing delay: waiting {delay}s before next contact...")
                for _ in range(delay):
                    if self._stop_requested or self._paused:
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
        while True:
            if self._stop_requested:
                return

            is_logged_in, requires_login, has_challenge, reason = await adapter.check_login()

            if has_challenge:
                logger.warning("[Worker] Instagram challenge detected — manual intervention needed")
                self.instagram_login_status = "CHALLENGE"
                await self._update_worker_db(instagram_login_status="CHALLENGE")
                await event_bus.publish(EventCode.MANUAL_REVIEW_REQUIRED, payload={"reason": reason}, worker_id=WORKER_ID)
                await event_bus.publish_state(await self.health())
                await asyncio.sleep(6)
                continue

            if is_logged_in:
                logger.info("[Worker] Instagram session active")
                self.instagram_login_status = "LOGGED_IN"
                await self._update_worker_db(instagram_login_status="LOGGED_IN")
                await event_bus.publish(EventCode.LOGIN_DETECTED, worker_id=WORKER_ID)
                await event_bus.publish_state(await self.health())
                return

            if requires_login:
                logger.warning("[Worker] LOGIN_REQUIRED — waiting for user to log in manually")
                self.instagram_login_status = "LOGIN_REQUIRED"
                await self._update_worker_db(instagram_login_status="LOGIN_REQUIRED")
                await event_bus.publish(EventCode.LOGIN_REQUIRED, payload={"reason": reason}, worker_id=WORKER_ID)
                await event_bus.publish_state(await self.health())
                await asyncio.sleep(6)
                continue

            await asyncio.sleep(4)

    async def _claim_next_task(self):
        async with AsyncSessionLocal() as session:
            repo = TaskRepository(session)
            task = await repo.claim_next_ready(WORKER_ID)
            if task:
                await event_bus.publish(EventCode.TASK_CLAIMED, task_id=task.id, worker_id=WORKER_ID)
            return task

    async def _process_task(self, task, adapter: InstagramAdapter) -> None:
        task_id = task.id
        contact = task.contact
        if not contact:
            async with AsyncSessionLocal() as session:
                repo = TaskRepository(session)
                await repo.update_status(task_id, TaskStatus.SKIPPED, worker_id=WORKER_ID)
            return

        # Pre-send Follow-up Race Check
        if task.type in {"FOLLOW_UP_1", "FOLLOW_UP_2"}:
            async with AsyncSessionLocal() as session:
                safe, fu_reason = await FollowUpService.verify_before_send(session, task_id)
                if not safe:
                    logger.info(f"[Worker] Follow-up safety check blocked execution: {fu_reason}")
                    return

        if task.type == "FOLLOW_UP_1":
            message_body = contact.followup_1_message or "Hey! Just following up on my previous message — would love to connect!"
        elif task.type == "FOLLOW_UP_2":
            message_body = contact.followup_2_message or "Hey! One final quick check-in — let me know if you'd like more details."
        else:
            message_body = contact.message or settings.DEFAULT_MESSAGE

        try:
            # Heartbeat task lease
            async with AsyncSessionLocal() as session:
                repo = TaskRepository(session)
                await repo.heartbeat(task_id, WORKER_ID)

            active_page = await self.browser_worker.get_active_instagram_page(prefer_target_url=contact.instagram_url)
            if active_page and not active_page.is_closed():
                self.browser_worker.page = active_page
                adapter.page = active_page
                try:
                    await adapter.page.bring_to_front()
                except Exception:
                    pass

            # ── 1. Open Profile ──────────────────────────────────
            if not network_monitor.is_online():
                await self._fail_task(task_id, ResultCode.NETWORK_ERROR, "Network offline before opening profile", new_status=TaskStatus.RETRY_WAIT, retryable=True)
                return

            await self._set_stage(AutomationStage.OPENING_PROFILE, contact.name, contact.instagram_url, task_id)
            await event_bus.publish(EventCode.TASK_STARTED, task_id=task_id, contact_name=contact.name,
                                    worker_id=WORKER_ID, payload={"instagram_url": contact.instagram_url})

            success, result_code, reason = await adapter.open_profile(contact.instagram_url, expected_username=contact.username)
            await self.browser_worker.screenshot("profile_opened")

            if not success:
                if "target page, context or browser has been closed" in str(reason).lower():
                    logger.warning("[Worker] Browser closed/disconnected during open_profile.")
                    self.browser_worker.is_running = False
                await self._fail_task(task_id, result_code, reason)
                return

            # ── 2. Transition to VERIFYING & Extract Profile ──────────────
            async with AsyncSessionLocal() as session:
                repo = TaskRepository(session)
                await repo.update_status(task_id, TaskStatus.VERIFYING, worker_id=WORKER_ID)

            await self._set_stage(AutomationStage.EXTRACTING_PROFILE, contact.name, task_id=task_id)
            extracted = await adapter.extract_profile()

            # ── 3. Identity Verification ───────────────────────────
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

            async with AsyncSessionLocal() as session:
                vrf_repo = VerificationRepository(session)
                screenshot_url = await self.browser_worker.screenshot("verification_completed")
                await vrf_repo.record_result(
                    task_id=task_id,
                    contact_id=contact.id,
                    confidence=verification.confidence,
                    decision=verification.decision.value,
                    signals=[s.dict() for s in verification.signals],
                    screenshot_path=screenshot_url,
                    reason=verification.reason
                )

            await event_bus.publish(
                EventCode.VERIFICATION_COMPLETED,
                task_id=task_id,
                worker_id=WORKER_ID,
                payload={"confidence": verification.confidence, "decision": verification.decision.value}
            )

            # Strict Invariant: NO UNVERIFIED IDENTITY -> SEND
            if verification.decision in {VerificationDecision.MISMATCH, VerificationDecision.LOW_CONFIDENCE, VerificationDecision.UNKNOWN}:
                await self._fail_task(
                    task_id,
                    ResultCode.PROFILE_MISMATCH if verification.decision == VerificationDecision.MISMATCH else ResultCode.UNKNOWN,
                    verification.reason,
                    new_status=TaskStatus.MANUAL_REVIEW,
                    retryable=False
                )
                return

            await event_bus.publish(EventCode.PROFILE_VERIFIED, task_id=task_id, worker_id=WORKER_ID)

            # ── 4. Approval Gate ──────────────────────────────────
            requires_approval = getattr(task, "requires_approval", False) or settings.REQUIRE_MANUAL_APPROVAL or (verification.decision == VerificationDecision.MEDIUM_CONFIDENCE)
            if requires_approval and task.status != TaskStatus.APPROVED.value:
                async with AsyncSessionLocal() as session:
                    repo = TaskRepository(session)
                    await repo.update_status(task_id, TaskStatus.AWAITING_APPROVAL, worker_id=WORKER_ID)
                await event_bus.publish(
                    EventCode.MANUAL_REVIEW_REQUIRED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    payload={"reason": "Manual operator approval required before send."}
                )
                logger.info(f"[Worker] Task {task_id} is awaiting manual approval before send.")
                return

            # ── 5. Check DM Availability ─────────────────────────
            await self._set_stage(AutomationStage.CHECKING_DM_AVAILABILITY, contact.name, task_id=task_id)
            dm_available, dm_code, dm_reason = await adapter.check_message_availability()

            if not dm_available:
                await self._fail_task(task_id, dm_code, dm_reason, new_status=TaskStatus.SKIPPED, retryable=False)
                return

            # ── 6. Prepare Message ───────────────────────────────
            await self._set_stage(AutomationStage.OPENING_COMPOSER, contact.name, task_id=task_id)
            prepared, prep_code, prep_reason = await adapter.prepare_message(message_body)
            await self.browser_worker.screenshot("message_composer_opened")

            if not prepared:
                await self._fail_task(task_id, prep_code, prep_reason, retryable=False)
                return

            # ── 7. Transition to SENDING ──────────────────────────
            attempt_id = str(uuid.uuid4())
            browser_sid = str(id(self.browser_worker))
            now = datetime.now(timezone.utc)

            async with AsyncSessionLocal() as session:
                msg_repo = MessageRepository(session)
                msg = await msg_repo.create(contact.id, task_id, message_body)
                msg_id = msg.id

                # P0.1: Persist durable SendAttempt record BEFORE the irreversible Send action
                await msg_repo.record_send_attempt(
                    task_id=task_id,
                    message_id=msg_id,
                    attempt_id=attempt_id,
                    contact_id=contact.id,
                    message_body=message_body,
                    worker_id=WORKER_ID,
                    browser_session_id=browser_sid
                )

                task_repo = TaskRepository(session)
                current_t = await task_repo.get_by_id(task_id)
                current_t.send_attempt_id = attempt_id
                current_t.send_requested_at = now
                current_t.browser_session_id = browser_sid
                await task_repo.update_status(task_id, TaskStatus.SENDING, worker_id=WORKER_ID)

            await self._set_stage(AutomationStage.SENDING_MESSAGE, contact.name, task_id=task_id)
            await event_bus.publish(
                EventCode.SEND_STARTED,
                task_id=task_id,
                worker_id=WORKER_ID,
                payload={"attempt_id": attempt_id, "body": message_body}
            )

            # ── 8. Send Action ────────────────────────────────────
            send_code = ResultCode.UNKNOWN
            send_reason = ""
            try:
                sent, send_code, send_reason = await adapter.send_message()
            except Exception as send_exc:
                if not network_monitor.is_online():
                    send_code = ResultCode.SEND_UNKNOWN
                    send_reason = f"Network disconnected during send: {send_exc}"
                else:
                    send_code = ResultCode.SEND_UNKNOWN
                    send_reason = f"Exception during send action: {send_exc}"
                sent = False

            await self.browser_worker.screenshot("message_attempted")

            # ── 9. Result Verification & Reconciliation ────────────
            await self._set_stage(AutomationStage.DETECTING_RESULT, contact.name, task_id=task_id)
            if send_code == ResultCode.SEND_UNKNOWN:
                result = ResultCode.SEND_UNKNOWN
            else:
                try:
                    result = await adapter.detect_result(message_body)
                except Exception as det_exc:
                    logger.warning(f"[Worker] Result detection exception: {det_exc}")
                    result = ResultCode.SEND_UNKNOWN

            await self.browser_worker.screenshot("message_result")

            now = datetime.now(timezone.utc)

            if result == ResultCode.SUCCESS:
                self.batch_sent_count += 1
                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "SENT", "SUCCESS")
                    await msg_repo.update_send_attempt(attempt_id, "CONFIRMED", "SUCCESS")

                    task_repo = TaskRepository(session)
                    current_t = await task_repo.get_by_id(task_id)
                    current_t.send_confirmed_at = now
                    await task_repo.update_status(task_id, TaskStatus.COMPLETED, worker_id=WORKER_ID)

                    # Follow-up scheduling using FollowUpService
                    if task.type == "MESSAGE":
                        await FollowUpService.schedule_followup(session, contact.id, "FOLLOW_UP_1")
                    elif task.type == "FOLLOW_UP_1":
                        await FollowUpService.schedule_followup(session, contact.id, "FOLLOW_UP_2")

                await event_bus.publish(
                    EventCode.SEND_CONFIRMED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    contact_name=contact.name,
                    payload={"result": "SUCCESS", "batch_sent": self.batch_sent_count, "batch_limit": self.batch_limit}
                )
                await event_bus.publish(EventCode.TASK_COMPLETED, task_id=task_id, worker_id=WORKER_ID)
                logger.info(f"[Worker] Task {task_id} COMPLETED — {contact.name}")

                # P4.3: Decoupled Source Write-back (failure does NOT resend Instagram message)
                try:
                    async with AsyncSessionLocal() as session:
                        sync_ok = await SourceSyncService.sync_task_outcome(session, task_id, status="SENT")
                        if not sync_ok:
                            logger.warning(f"[Worker] Source write-back failed for task {task_id}. Message remains SENT.")
                except Exception as sync_err:
                    logger.error(f"[Worker] Source sync error for task {task_id}: {sync_err}")

            elif result in {ResultCode.SEND_UNKNOWN, ResultCode.UNKNOWN}:
                # Invariant: NO UNCERTAIN SEND -> AUTOMATIC RETRY
                logger.warning(f"[Worker] Task {task_id} send result is ambiguous. Transitioning to RECONCILING...")
                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "UNKNOWN", "SEND_UNKNOWN")
                    await msg_repo.update_send_attempt(attempt_id, "UNKNOWN", "SEND_UNKNOWN")

                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.RECONCILING, worker_id=WORKER_ID)

                    # Immediate conversation reconciliation attempt
                    rec = RecoveryService(session)
                    rec_status = await rec.reconcile_task_with_conversation(task_id, adapter, expected_text=message_body)
                    logger.info(f"[Worker] Reconciliation outcome for task {task_id}: {rec_status}")

                await event_bus.publish(
                    EventCode.SEND_UNKNOWN,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    payload={"reason": "Ambiguous post-send confirmation"}
                )

            elif result in {ResultCode.RATE_LIMITED, ResultCode.ACTION_BLOCKED}:
                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "FAILED", result.value)
                    await msg_repo.update_send_attempt(attempt_id, "FAILED", result.value)

                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW, worker_id=WORKER_ID)

                self._paused = True
                self.status = WorkerStatus.PAUSED
                await self._update_worker_db(status="PAUSED")
                await event_bus.publish(
                    EventCode.MANUAL_REVIEW_REQUIRED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    payload={"reason": f"Instagram {result.value} detected. Worker paused for safety."}
                )

            else:
                # Deterministic or transient failure
                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "FAILED", result.value)
                    await msg_repo.update_send_attempt(attempt_id, "FAILED", result.value)

                retry_decision = RetryPolicy.classify(result, attempt=1, error_message=send_reason)
                new_status = TaskStatus.RETRY_WAIT if retry_decision.should_retry else TaskStatus.MANUAL_REVIEW

                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, new_status, worker_id=WORKER_ID)

                await event_bus.publish(
                    EventCode.SEND_FAILED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    payload={"code": result.value, "retryable": retry_decision.should_retry}
                )

        except Exception as e:
            logger.exception(f"[Worker] Error processing task {task_id}: {e}")
            await self.browser_worker.screenshot("error")
            try:
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW, worker_id=WORKER_ID)
            except Exception as db_err:
                logger.error(f"[Worker] Failed to update task status after error: {db_err}")
            await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, worker_id=WORKER_ID, payload={"error": str(e)})

        await asyncio.sleep(1)

    async def _fail_task(self, task_id: str, result_code: ResultCode, reason: str,
                         new_status: TaskStatus = TaskStatus.RETRY_WAIT, retryable: bool = False) -> None:
        retry_decision = RetryPolicy.classify(result_code, attempt=1, error_message=reason)
        status_to_set = TaskStatus.RETRY_WAIT if retry_decision.should_retry else new_status

        async with AsyncSessionLocal() as session:
            task_repo = TaskRepository(session)
            await task_repo.update_status(task_id, status_to_set, worker_id=WORKER_ID)

        await event_bus.publish(
            EventCode.TASK_FAILED,
            task_id=task_id,
            worker_id=WORKER_ID,
            payload={"code": result_code.value, "reason": reason, "retryable": retry_decision.should_retry}
        )
        logger.warning(f"[Worker] Task {task_id} failed: {result_code.value} — {reason}")

instagram_worker = InstagramWorker()
