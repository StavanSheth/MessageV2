"""
Instagram Worker: the heart of automation.
Runs sequentially through tasks, controlling the visible Chrome browser.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession

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

logger = logging.getLogger(__name__)

WORKER_ID = "WORKER-01"
WORKER_NAME = "Instagram Worker 01"

class InstagramWorker:
    def __init__(self):
        self.browser_worker = BrowserWorker()
        self.status = WorkerStatus.IDLE
        self.stage = AutomationStage.IDLE
        self.current_task_id: Optional[str] = None
        self.current_contact_name: Optional[str] = None
        self.current_instagram: Optional[str] = None
        self._paused = False
        self._stop_requested = False
        self._task: Optional[asyncio.Task] = None
        self._start_time: Optional[datetime] = None

    # ───────────────────────────────────────────────
    # Control methods
    # ───────────────────────────────────────────────

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop_requested = False
        self._paused = False
        self._task = asyncio.create_task(self._run_loop())
        logger.info(f"[Worker] {WORKER_NAME} started")

    async def pause(self) -> None:
        self._paused = True
        self.status = WorkerStatus.PAUSED
        await self._update_worker_db(status="PAUSED")
        await event_bus.publish(EventCode.WORKER_PAUSED, worker_id=WORKER_ID)

    async def resume(self) -> None:
        self._paused = False
        self.status = WorkerStatus.RUNNING
        await self._update_worker_db(status="RUNNING")
        await event_bus.publish(EventCode.WORKER_RESUMED, worker_id=WORKER_ID)

    async def stop(self) -> None:
        self._stop_requested = True
        self._paused = False
        if self._task:
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        await self.browser_worker.stop()
        self.status = WorkerStatus.STOPPED
        await self._update_worker_db(status="STOPPED", browser_status="DISCONNECTED", current_stage="IDLE")
        await event_bus.publish(EventCode.WORKER_STOPPED, worker_id=WORKER_ID)
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
            "current_task_id": self.current_task_id,
            "current_contact_name": self.current_contact_name,
            "current_instagram": self.current_instagram,
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
            # Initialize browser
            await self._set_stage(AutomationStage.INITIALIZING)
            page = await self.browser_worker.start()
            await self._update_worker_db(status="RUNNING", browser_status="CONNECTED")
            await event_bus.publish(EventCode.WORKER_STARTED, worker_id=WORKER_ID)

            # Instagram login check
            await self._set_stage(AutomationStage.CHECKING_LOGIN)
            adapter = InstagramAdapter(page)
            await self._check_login_loop(adapter)

            # Task processing loop
            while not self._stop_requested:
                if self._paused:
                    await asyncio.sleep(1)
                    continue

                task = await self._claim_next_task()
                if not task:
                    await asyncio.sleep(3)
                    continue

                contact = task.contact
                self.current_task_id = task.id
                self.current_contact_name = contact.name if contact else "Unknown"
                self.current_instagram = contact.instagram_url if contact else ""

                await self._process_task(task, adapter)

        except asyncio.CancelledError:
            logger.info("[Worker] Task loop cancelled")
        except Exception as e:
            logger.exception(f"[Worker] Fatal error: {e}")
            self.status = WorkerStatus.ERROR
            await self._update_worker_db(status="ERROR")
        finally:
            self.status = WorkerStatus.STOPPED
            self.stage = AutomationStage.IDLE

    async def _check_login_loop(self, adapter: InstagramAdapter) -> None:
        while True:
            is_logged_in, requires_login, has_challenge, reason = await adapter.check_login()

            if has_challenge:
                logger.warning("[Worker] Instagram challenge detected — manual intervention needed")
                await self._update_worker_db(instagram_login_status="CHALLENGE")
                await event_bus.publish(EventCode.MANUAL_REVIEW_REQUIRED, payload={"reason": reason}, worker_id=WORKER_ID)
                # Wait for human intervention
                await asyncio.sleep(10)
                continue

            if is_logged_in:
                logger.info("[Worker] Instagram session active")
                await self._update_worker_db(instagram_login_status="LOGGED_IN")
                await event_bus.publish(EventCode.LOGIN_DETECTED, worker_id=WORKER_ID)
                return

            if requires_login:
                logger.warning("[Worker] LOGIN_REQUIRED — waiting for user to log in manually")
                await self._update_worker_db(instagram_login_status="LOGIN_REQUIRED")
                await event_bus.publish(EventCode.LOGIN_REQUIRED, payload={"reason": reason}, worker_id=WORKER_ID)
                await asyncio.sleep(8)
                continue

            # Unclear state — retry
            await asyncio.sleep(5)

    async def _claim_next_task(self):
        async with AsyncSessionLocal() as session:
            repo = TaskRepository(session)
            return await repo.claim_next_ready(WORKER_ID)

    async def _process_task(self, task, adapter: InstagramAdapter) -> None:
        task_id = task.id
        contact = task.contact
        if not contact:
            async with AsyncSessionLocal() as session:
                repo = TaskRepository(session)
                await repo.update_status(task_id, TaskStatus.SKIPPED)
            return

        correlation_id = task_id
        message_body = contact.message or settings.DEFAULT_MESSAGE

        try:
            # ── Open Profile ──────────────────────────────────
            await self._set_stage(AutomationStage.OPENING_PROFILE, contact.name, contact.instagram_url, task_id)
            await event_bus.publish(EventCode.TASK_STARTED, task_id=task_id, contact_name=contact.name,
                                    worker_id=WORKER_ID, payload={"instagram_url": contact.instagram_url})

            success, result_code, reason = await adapter.open_profile(contact.instagram_url)
            await self.browser_worker.screenshot("profile_opened")

            if not success:
                await self._fail_task(task_id, result_code, reason)
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
            prepared, prep_reason = await adapter.prepare_message(message_body)
            screenshot_url = await self.browser_worker.screenshot("message_composer_opened")

            if not prepared:
                await self._fail_task(task_id, ResultCode.SEND_FAILED, prep_reason, retryable=True)
                return

            # Create message record
            async with AsyncSessionLocal() as session:
                msg_repo = MessageRepository(session)
                msg = await msg_repo.create(contact.id, task_id, message_body)
                msg_id = msg.id

            # ── Send Message ──────────────────────────────────
            await self._set_stage(AutomationStage.SENDING_MESSAGE, contact.name, task_id=task_id)
            await event_bus.publish(EventCode.MESSAGE_ATTEMPTED, task_id=task_id, worker_id=WORKER_ID,
                                    payload={"body": message_body})

            sent, send_reason = await adapter.send_message()
            await self.browser_worker.screenshot("message_attempted")

            # ── Detect Result ─────────────────────────────────
            await self._set_stage(AutomationStage.DETECTING_RESULT, contact.name, task_id=task_id)
            result = await adapter.detect_result(message_body)
            await self.browser_worker.screenshot("message_result")

            if result == ResultCode.SUCCESS:
                async with AsyncSessionLocal() as session:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "SENT", "SUCCESS")
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.COMPLETED)
                await event_bus.publish(EventCode.MESSAGE_CONFIRMED, task_id=task_id, worker_id=WORKER_ID,
                                        contact_name=contact.name, payload={"result": "SUCCESS"})
                await event_bus.publish(EventCode.TASK_COMPLETED, task_id=task_id, worker_id=WORKER_ID)
                logger.info(f"[Worker] Task {task_id} COMPLETED — {contact.name}")

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
                    await task_repo.update_status(task_id, new_status)
                await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, worker_id=WORKER_ID,
                                        payload={"result": result.value, "retryable": is_retryable})

        except Exception as e:
            logger.exception(f"[Worker] Error processing task {task_id}: {e}")
            await self.browser_worker.screenshot("error")
            try:
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    await task_repo.update_status(task_id, TaskStatus.RETRY_WAIT)
            except Exception:
                pass
            await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, worker_id=WORKER_ID,
                                    payload={"error": str(e)})

        # Brief pause between tasks
        await asyncio.sleep(2)

    async def _fail_task(self, task_id: str, result_code: ResultCode, reason: str,
                         new_status: TaskStatus = TaskStatus.RETRY_WAIT, retryable: bool = True) -> None:
        async with AsyncSessionLocal() as session:
            task_repo = TaskRepository(session)
            await task_repo.update_status(task_id, new_status)
        await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, worker_id=WORKER_ID,
                                payload={"code": result_code.value, "reason": reason, "retryable": retryable})
        logger.warning(f"[Worker] Task {task_id} failed: {result_code.value} — {reason}")


# Singleton worker instance
instagram_worker = InstagramWorker()
