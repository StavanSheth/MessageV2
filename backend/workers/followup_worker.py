"""
Follow-Up Worker (Worker 3): Dedicated follow-up outreach engine.
Strictly processes FOLLOW_UP_1 and FOLLOW_UP_2 tasks for unreplied contacts.
Enforces mutual exclusion with Worker 1 via DMCoordinator.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Task, Contact, Message, Error
from backend.automation.instagram.browser import BrowserWorker
from backend.automation.instagram.instagram_adapter import InstagramAdapter
from backend.automation.instagram.result_detector import ResultDetector
from backend.verification.verification_service import VerificationService
from backend.repositories.task_repository import TaskRepository
from backend.repositories.contact_repository import ContactRepository
from backend.repositories.worker_repository import WorkerRepository, MessageRepository, VerificationRepository
from backend.database.session import AsyncSessionLocal
from backend.domain.enums import (
    TaskStatus, ResultCode, EventCode, AutomationStage, WorkerStatus
)
from backend.config.settings import settings
from backend.events.event_bus import event_bus
from backend.automation.extension_bridge import extension_bridge, ExtensionAdapter
from backend.automation.coordinator import coordinator

logger = logging.getLogger(__name__)

WORKER_ID = "WORKER-03"
WORKER_NAME = "Follow-Up Dispatcher (Worker 3)"

class FollowUpWorker:
    def __init__(self):
        self.browser_worker = BrowserWorker()
        self.status = WorkerStatus.IDLE
        self.stage = AutomationStage.IDLE
        self.instagram_login_status = "UNKNOWN"
        self.current_task_id: Optional[str] = None
        self.current_contact_name: Optional[str] = None
        self.current_instagram: Optional[str] = None
        self.current_touch: str = "FOLLOW_UP_1"
        self.batch_limit: Optional[int] = None
        self.batch_sent_count: int = 0
        self.delay_between_messages: int = 15
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

        # Mutual exclusion: Acquire DM lock before starting
        await coordinator.acquire_dm_lock(WORKER_ID)

        self.batch_limit = batch_limit if (batch_limit is not None and batch_limit > 0) else None
        self.batch_sent_count = 0
        if delay_seconds is not None and delay_seconds >= 5:
            self.delay_between_messages = delay_seconds
        self._stop_requested = False
        self._paused = False

        # Reset any orphaned tasks claimed by Worker 3 in RUNNING back to READY
        try:
            async with AsyncSessionLocal() as session:
                task_repo = TaskRepository(session)
                orphaned = await task_repo.list_interrupted()
                for ot in orphaned:
                    if ot.worker_id == WORKER_ID:
                        await task_repo.update_status(ot.id, TaskStatus.READY, worker_id=None)
        except Exception as e:
            logger.error(f"[Worker 3] Error recovering interrupted tasks: {e}")

        self._task = asyncio.create_task(self._run_loop())
        logger.info(f"[Worker 3] {WORKER_NAME} started (batch_limit={self.batch_limit}, delay={self.delay_between_messages}s)")

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

        if self.current_task_id:
            try:
                async with AsyncSessionLocal() as session:
                    task_repo = TaskRepository(session)
                    current_task = await task_repo.get_by_id(self.current_task_id)
                    if current_task and current_task.status == TaskStatus.RUNNING.value:
                        await task_repo.update_status(self.current_task_id, TaskStatus.READY, worker_id=None)
            except Exception as e:
                logger.error(f"[Worker 3] Error releasing task on stop: {e}")
            self.current_task_id = None

        self.status = WorkerStatus.STOPPED
        self.stage = AutomationStage.IDLE
        await self._update_worker_db(status="STOPPED", current_stage="IDLE")
        await event_bus.publish(EventCode.WORKER_STOPPED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())

    async def health(self) -> Dict[str, Any]:
        due_count = 0
        future_count = 0
        next_due_at = None
        try:
            now = datetime.now(timezone.utc)
            async with AsyncSessionLocal() as session:
                due_stmt = select(func.count(Task.id)).where(
                    and_(Task.status == TaskStatus.READY.value, Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]), Task.scheduled_at <= now)
                )
                future_stmt = select(func.count(Task.id)).where(
                    and_(Task.status == TaskStatus.READY.value, Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]), Task.scheduled_at > now)
                )
                earliest_future_stmt = select(func.min(Task.scheduled_at)).where(
                    and_(Task.status == TaskStatus.READY.value, Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]), Task.scheduled_at > now)
                )
                due_count = (await session.execute(due_stmt)).scalar() or 0
                future_count = (await session.execute(future_stmt)).scalar() or 0
                next_due_at_dt = (await session.execute(earliest_future_stmt)).scalar_one_or_none()
                if next_due_at_dt:
                    next_due_at = next_due_at_dt.isoformat()
        except Exception:
            pass

        return {
            "worker_id": WORKER_ID,
            "worker_name": WORKER_NAME,
            "status": self.status.value if hasattr(self.status, 'value') else str(self.status),
            "stage": self.stage.value if hasattr(self.stage, 'value') else str(self.stage),
            "current_task_id": self.current_task_id,
            "current_contact_name": self.current_contact_name,
            "current_instagram": self.current_instagram,
            "current_touch": self.current_touch,
            "batch_sent_count": self.batch_sent_count,
            "batch_limit": self.batch_limit,
            "is_running": self.is_running,
            "is_paused": self.is_paused,
            "lock_held": coordinator.active_sender == WORKER_ID,
            "due_count": due_count,
            "future_count": future_count,
            "next_due_at": next_due_at
        }

    async def _update_worker_db(self, **kwargs) -> None:
        try:
            async with AsyncSessionLocal() as session:
                repo = WorkerRepository(session)
                await repo.update_status(WORKER_ID, **kwargs)
        except Exception:
            pass

    async def _claim_next_followup(self) -> Optional[Task]:
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
            return await repo.claim_next_ready(WORKER_ID, task_types=["FOLLOW_UP_1", "FOLLOW_UP_2"])

    async def _run_loop(self) -> None:
        self.status = WorkerStatus.RUNNING
        self._start_time = datetime.now(timezone.utc)
        await self._update_worker_db(status="RUNNING")
        await event_bus.publish(EventCode.WORKER_STARTED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())

        adapter: Optional[InstagramAdapter] = None
        if extension_bridge.is_connected:
            adapter = ExtensionAdapter()
        else:
            await self.browser_worker.launch(headless=False)
            adapter = InstagramAdapter(self.browser_worker.page, self.browser_worker)

        try:
            while not self._stop_requested:
                if self._paused:
                    await asyncio.sleep(1)
                    continue

                # Batch limit check
                if self.batch_limit is not None and self.batch_sent_count >= self.batch_limit:
                    logger.info(f"[Worker 3] Batch limit of {self.batch_limit} reached. Pausing safely.")
                    await self.pause()
                    continue

                task = await self._claim_next_followup()
                if not task:
                    # Check future scheduled follow-up tasks
                    async with AsyncSessionLocal() as session:
                        now = datetime.now(timezone.utc)
                        future_stmt = select(func.min(Task.scheduled_at)).where(
                            and_(
                                Task.status == TaskStatus.READY.value,
                                Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]),
                                Task.scheduled_at > now
                            )
                        )
                        next_due = (await session.execute(future_stmt)).scalar_one_or_none()

                    msg = (
                        f"All due follow-ups completed! Next follow-up is due at "
                        f"{next_due.strftime('%b %d, %Y %I:%M %p UTC') if next_due else 'N/A'}."
                    ) if next_due else "No pending follow-ups currently due."
                    logger.info(f"[Worker 3] {msg}")
                    self.status = WorkerStatus.IDLE
                    self.stage = AutomationStage.COMPLETED
                    await self._update_worker_db(status="IDLE", current_stage="COMPLETED")
                    await coordinator.release_dm_lock(WORKER_ID)
                    await event_bus.publish_state(await self.health())
                    break

                contact = task.contact
                self.current_task_id = task.id
                self.current_contact_name = contact.name if contact else "Unknown"
                self.current_instagram = contact.instagram_url if contact else ""
                try:
                    self.is_dispatching_dm = True
                    await self._process_followup(task, adapter)
                finally:
                    self.is_dispatching_dm = False

                # Batch limit check right after task
                if self.batch_limit is not None and self.batch_sent_count >= self.batch_limit:
                    logger.info(f"[Worker 3] Batch target reached ({self.batch_sent_count}/{self.batch_limit}). Auto-pausing.")
                    await self.pause()
                    continue

                # Pacing delay between follow-ups
                delay = self.delay_between_messages
                logger.info(f"[Worker 3] Pacing delay: waiting {delay}s before next follow-up...")
                for _ in range(delay):
                    while self._paused and not self._stop_requested:
                        await asyncio.sleep(1)
                    if self._stop_requested:
                        break
                    await asyncio.sleep(1)

        except asyncio.CancelledError:
            logger.info("[Worker 3] Task cancelled")
        except Exception as e:
            logger.exception(f"[Worker 3] Fatal error: {e}")
            self.status = WorkerStatus.ERROR
            await self._update_worker_db(status="ERROR")
        finally:
            self.status = WorkerStatus.STOPPED
            self.stage = AutomationStage.IDLE
            await coordinator.release_dm_lock(WORKER_ID)
            await self._update_worker_db(status="STOPPED", current_stage="IDLE")
            await event_bus.publish_state(await self.health())

    async def _process_followup(self, task: Task, adapter: InstagramAdapter) -> None:
        task_id = task.id

        # ── Pre-check: Verify contact still exists & hasn't replied ──
        async with AsyncSessionLocal() as session:
            t_repo = TaskRepository(session)
            db_task = await t_repo.get_by_id(task_id)
            if not db_task or not db_task.contact:
                logger.info(f"[Worker 3] Task {task_id} or contact deleted. Skipping.")
                self.current_task_id = None
                return
            contact = db_task.contact

            # If Worker 2 marked replied, cancel follow-up immediately
            if contact.replied_status in ["YES", "AUTOMATED_MESSAGE"]:
                logger.info(f"[Worker 3] Contact {contact.name} already replied ({contact.replied_status}). Cancelling follow-up task.")
                await t_repo.update_status(task_id, TaskStatus.CANCELLED)
                self.current_task_id = None
                return

        # Follow-up message body
        if task.type == "FOLLOW_UP_1":
            followup_body = contact.followup_1_message or settings.DEFAULT_MESSAGE
        else:
            followup_body = contact.followup_2_message or settings.DEFAULT_MESSAGE

        try:
            # ── Open Profile / Direct Conversation ──
            self.stage = AutomationStage.OPENING_PROFILE
            await event_bus.publish(
                EventCode.TASK_STARTED,
                task_id=task_id,
                contact_name=contact.name,
                worker_id=WORKER_ID,
                payload={"instagram_url": contact.instagram_url, "stage": task.type}
            )

            success, result_code, reason = await adapter.open_profile(contact.instagram_url)
            if not success:
                logger.warning(f"[Worker 3] Failed to open profile {contact.instagram_url}: {reason}")
                async with AsyncSessionLocal() as session:
                    t_repo = TaskRepository(session)
                    await t_repo.update_status(task_id, TaskStatus.RETRY_WAIT)
                self.current_task_id = None
                return

            # Pause & Stop Check
            while self._paused and not self._stop_requested:
                await asyncio.sleep(1)
            if self._stop_requested:
                return

            # Re-verify latest contact state & reply status before initiating follow-up send
            async with AsyncSessionLocal() as chk_session:
                chk_c = await chk_session.get(Contact, contact.id)
                if chk_c and chk_c.replied_status in ["YES", "AUTOMATED_MESSAGE"]:
                    logger.info(f"[Worker 3] Contact {contact.name} already replied ({chk_c.replied_status}). Aborting follow-up send.")
                    t_repo = TaskRepository(chk_session)
                    await t_repo.update_status(task_id, TaskStatus.CANCELLED, manual_review_reason=f"Cancelled: Contact replied {chk_c.replied_status}")
                    self.current_task_id = None
                    return
                if chk_c:
                    if task.type == "FOLLOW_UP_2":
                        from sqlalchemy import select, and_
                        fu1_stmt = select(Task).where(
                            and_(Task.contact_id == contact.id, Task.type == "FOLLOW_UP_1")
                        )
                        fu1_task = (await chk_session.execute(fu1_stmt)).scalar_one_or_none()
                        if not fu1_task or fu1_task.status != TaskStatus.COMPLETED.value:
                            logger.warning(f"[Worker 3] Cannot send Follow-Up 2 for {contact.name}: Follow-Up 1 was not completed (status: {getattr(fu1_task, 'status', 'None')}). Aborting.")
                            t_repo = TaskRepository(chk_session)
                            await t_repo.update_status(task_id, TaskStatus.CANCELLED, manual_review_reason="Cancelled: Follow-Up 1 was not completed")
                            self.current_task_id = None
                            return
                    if task.type == "FOLLOW_UP_1" and chk_c.followup_1_message:
                        followup_body = chk_c.followup_1_message
                    elif task.type == "FOLLOW_UP_2" and chk_c.followup_2_message:
                        followup_body = chk_c.followup_2_message

            # ── Send Follow-Up Message ──
            self.stage = AutomationStage.SENDING_MESSAGE
            await event_bus.publish(
                EventCode.MESSAGE_ATTEMPTED,
                task_id=task_id,
                worker_id=WORKER_ID,
                payload={"body": followup_body, "touch": task.type}
            )

            # Record pending message
            async with AsyncSessionLocal() as session:
                m_repo = MessageRepository(session)
                seq_num = 2 if task.type == "FOLLOW_UP_1" else 3
                msg = await m_repo.create(contact.id, task_id, followup_body, sequence=seq_num)
                msg_id = msg.id

            if isinstance(adapter, ExtensionAdapter):
                sent, send_reason, already_messaged, dm_restricted = await adapter.send_message(
                    check_history=False,
                    task_type=task.type
                )
            else:
                sent, send_reason = await adapter.send_message()
                already_messaged = False
                dm_restricted = False

            if dm_restricted:
                logger.warning(f"[Worker 3] Contact {contact.name} has DM restrictions: {send_reason}. Marking DM_RESTRICTED.")
                async with AsyncSessionLocal() as session:
                    t_repo = TaskRepository(session)
                    await t_repo.update_status(task_id, TaskStatus.SKIPPED)
                    c_repo = ContactRepository(session)
                    await c_repo.update(contact.id, {"replied_status": "DM_RESTRICTED", "notes": f"DM Restricted: {send_reason}"})
                    m_repo = MessageRepository(session)
                    await m_repo.update_result(msg_id, "SKIPPED", "DM_RESTRICTED")
                self.current_task_id = None
                return

            # ── Confirm Result ──
            self.stage = AutomationStage.DETECTING_RESULT
            result = await adapter.detect_result(followup_body)

            if result == ResultCode.SUCCESS:
                self.batch_sent_count += 1
                async with AsyncSessionLocal() as session:
                    m_repo = MessageRepository(session)
                    await m_repo.update_result(msg_id, "SENT", "SUCCESS")
                    t_repo = TaskRepository(session)
                    await t_repo.update_status(task_id, TaskStatus.COMPLETED)

                    # If this was Follow-Up 1, automatically schedule Follow-Up 2 (+5 days)
                    if task.type == "FOLLOW_UP_1" and contact.replied_status not in ["YES", "AUTOMATED_MESSAGE"]:
                        fu2_delay = contact.followup_2_delay_days or 5
                        now = datetime.now(timezone.utc)
                        fu2_task = Task(
                            contact_id=contact.id,
                            type="FOLLOW_UP_2",
                            sequence=3,
                            priority=task.priority,
                            scheduled_at=now + timedelta(days=fu2_delay),
                            status=TaskStatus.READY.value
                        )
                        session.add(fu2_task)
                        await session.commit()
                        logger.info(f"[Worker 3] Follow-Up 1 completed! Scheduled Follow-Up 2 for {contact.name} in {fu2_delay} days.")

                    # Record OutreachHistory entry to retain long-term memory
                    try:
                        from backend.database.models import OutreachHistory
                        history_entry = OutreachHistory(
                            username=contact.username,
                            instagram_url=contact.instagram_url,
                            contact_name=contact.name,
                            action=task.type,
                            details=f"Sent {task.type} successfully"
                        )
                        session.add(history_entry)
                        await session.commit()
                    except Exception as e:
                        logger.warning(f"[Worker 3] Could not record outreach history: {e}")

                await event_bus.publish(
                    EventCode.MESSAGE_CONFIRMED,
                    task_id=task_id,
                    worker_id=WORKER_ID,
                    contact_name=contact.name,
                    payload={"result": "SUCCESS", "touch": task.type, "batch_sent": self.batch_sent_count}
                )
                await event_bus.publish(EventCode.TASK_COMPLETED, task_id=task_id, worker_id=WORKER_ID)
                logger.info(f"[Worker 3] {task.type} COMPLETED for {contact.name} ({self.batch_sent_count}/{self.batch_limit or 'All'})")

            elif result == ResultCode.RATE_LIMITED:
                # Rate limit safety
                logger.warning(f"[Worker 3] Rate limit detected on {task_id}. Auto-pausing Worker 3.")
                async with AsyncSessionLocal() as session:
                    t_repo = TaskRepository(session)
                    await t_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW)
                await self.pause()

            self.current_task_id = None

        except Exception as e:
            logger.error(f"[Worker 3] Error processing task {task_id}: {e}")
            async with AsyncSessionLocal() as session:
                t_repo = TaskRepository(session)
                await t_repo.update_status(task_id, TaskStatus.RETRY_WAIT)
            self.current_task_id = None

followup_worker = FollowUpWorker()
