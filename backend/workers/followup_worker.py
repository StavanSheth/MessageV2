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
from backend.automation.message_matcher import is_system_sequence_message

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
        self.current_run_id: Optional[str] = None
        self.run_completed_task_ids: List[str] = []
        self.run_completed_contact_ids: List[str] = []
        self.run_sent_records: List[Dict[str, Any]] = []
        self._paused = False
        self._stop_requested = False
        self.is_dispatching_dm = False
        self._task: Optional[asyncio.Task] = None
        self._start_time: Optional[datetime] = None
        self.last_scan_at: Optional[str] = None
        self.random_order: bool = False
        self.target_task_ids: Optional[List[str]] = None

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def is_paused(self) -> bool:
        return self._paused

    def set_random_order(self, enabled: bool) -> None:
        self.random_order = enabled
        logger.info(f"[{WORKER_NAME}] Random order selection set to: {enabled}")

    async def start(self, batch_limit: Optional[int] = None, delay_seconds: Optional[int] = None, random_order: Optional[bool] = None, task_ids: Optional[List[str]] = None) -> None:
        if random_order is not None:
            self.random_order = random_order

        if task_ids is not None:
            self.target_task_ids = list(task_ids)
            if not batch_limit or batch_limit <= 0:
                batch_limit = len(self.target_task_ids)

        if self._paused or self.status == WorkerStatus.PAUSED:
            if batch_limit is not None and batch_limit > 0:
                self.batch_limit = batch_limit
                self.batch_sent_count = 0
            elif self.batch_limit is not None and self.batch_sent_count >= self.batch_limit:
                self.batch_sent_count = 0
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
        self.current_run_id = f"fu_run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
        self.run_completed_task_ids = []
        self.run_completed_contact_ids = []
        self.run_sent_records = []
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

    async def _revert_task_to_ready(self, task_id: str, cancel_pending_msg: bool = False, msg_id: Optional[str] = None) -> None:
        try:
            async with AsyncSessionLocal() as session:
                task_repo = TaskRepository(session)
                await task_repo.update_status(task_id, TaskStatus.READY, worker_id=None)
                if cancel_pending_msg and msg_id:
                    msg_repo = MessageRepository(session)
                    await msg_repo.update_result(msg_id, "CANCELLED", "OPERATION_ABORTED")
        except Exception as e:
            logger.warning(f"[{WORKER_NAME}] Error reverting task {task_id} to READY: {e}")
        self.current_task_id = None
        self.stage = AutomationStage.IDLE

    async def pause(self) -> None:
        self._paused = True
        self.status = WorkerStatus.PAUSED
        self.stage = AutomationStage.IDLE
        coordinator.clear_preemption()
        await coordinator.release_dm_lock(WORKER_ID, auto_resume=False)
        try:
            from backend.automation.extension_bridge import extension_bridge
            await extension_bridge.abort_current_action()
        except Exception:
            pass

        if self.current_task_id:
            logger.info(f"[{WORKER_NAME}] Worker paused mid-task. Reverting task {self.current_task_id} to READY.")
            await self._revert_task_to_ready(self.current_task_id)

        await self._update_worker_db(status="PAUSED", current_stage="IDLE", current_task_id=None)
        await event_bus.publish(EventCode.WORKER_PAUSED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())
        logger.info(f"[{WORKER_NAME}] Worker paused successfully.")

    async def resume(self) -> None:
        coordinator.clear_preemption()
        await coordinator.acquire_dm_lock(WORKER_ID)
        self._stop_requested = False
        self._paused = False
        if self.batch_limit is not None and self.batch_sent_count >= self.batch_limit:
            self.batch_sent_count = 0
        self.status = WorkerStatus.RUNNING
        if not self._task or self._task.done():
            self._task = asyncio.create_task(self._run_loop())
        await self._update_worker_db(status="RUNNING")
        await event_bus.publish(EventCode.WORKER_RESUMED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())
        logger.info(f"[{WORKER_NAME}] Worker resumed successfully.")

    async def stop(self) -> None:
        self._stop_requested = True
        self._paused = False
        coordinator.clear_preemption()
        await coordinator.release_dm_lock(WORKER_ID, auto_resume=False)
        try:
            from backend.automation.extension_bridge import extension_bridge
            await extension_bridge.abort_current_action()
        except Exception:
            pass
        task_to_cancel = self._task
        self._task = None
        if task_to_cancel and not task_to_cancel.done():
            task_to_cancel.cancel()
            try:
                await asyncio.wait_for(task_to_cancel, timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass

        if self.current_task_id:
            logger.info(f"[{WORKER_NAME}] Worker stopped mid-task. Reverting task {self.current_task_id} to READY.")
            await self._revert_task_to_ready(self.current_task_id)

        self.status = WorkerStatus.STOPPED
        self.stage = AutomationStage.IDLE
        self.is_dispatching_dm = False
        await self._update_worker_db(status="STOPPED", current_stage="IDLE", current_task_id=None)
        await event_bus.publish(EventCode.WORKER_STOPPED, worker_id=WORKER_ID)
        await event_bus.publish_state(await self.health())
        logger.info(f"[{WORKER_NAME}] Worker stopped successfully.")

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

        if not self.last_scan_at:
            try:
                from backend.automation.scan_tracker import load_last_scan
                self.last_scan_at = await load_last_scan(WORKER_ID)
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
            "current_run_id": self.current_run_id,
            "run_completed_task_ids": self.run_completed_task_ids,
            "run_completed_contact_ids": self.run_completed_contact_ids,
            "run_sent_records": self.run_sent_records,
            "is_running": self.is_running,
            "is_paused": self.is_paused,
            "lock_held": coordinator.active_sender == WORKER_ID,
            "due_count": due_count,
            "future_count": future_count,
            "next_due_at": next_due_at,
            "last_scan_at": self.last_scan_at,
            "last_scanned_at": self.last_scan_at,
            "random_order": self.random_order,
            "target_task_ids": self.target_task_ids
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
            task = await repo.claim_next_ready(
                WORKER_ID,
                task_types=["FOLLOW_UP_1", "FOLLOW_UP_2"],
                random_order=self.random_order,
                task_ids=self.target_task_ids
            )
            if task and self.target_task_ids:
                if task.id in self.target_task_ids:
                    self.target_task_ids.remove(task.id)
            return task

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

                try:
                    from backend.automation.scan_tracker import persist_last_scan
                    self.last_scan_at = await persist_last_scan(WORKER_ID)
                except Exception:
                    pass

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
                    await coordinator.release_dm_lock(WORKER_ID, auto_resume=False)
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
            if not self._paused:
                if self.status != WorkerStatus.IDLE:
                    self.status = WorkerStatus.STOPPED
                    self.stage = AutomationStage.IDLE
                    await self._update_worker_db(status="STOPPED", current_stage="IDLE")
                await coordinator.release_dm_lock(WORKER_ID, auto_resume=False)
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
                if chk_c and chk_c.replied_status == "DM_RESTRICTED":
                    logger.info(f"[Worker 3] Contact {contact.name} is DM_RESTRICTED. Skipping follow-up.")
                    t_repo = TaskRepository(chk_session)
                    await t_repo.update_status(task_id, TaskStatus.SKIPPED, manual_review_reason="[DM_RESTRICTED] Contact cannot receive message requests")
                    self.current_task_id = None
                    return

                if chk_c:
                    # Stale scheduled date safeguard (> 30 days past due)
                    now_dt = datetime.now(timezone.utc)
                    task_scheduled = task.scheduled_at
                    if task_scheduled and task_scheduled.tzinfo is None:
                        task_scheduled = task_scheduled.replace(tzinfo=timezone.utc)
                    if task_scheduled and (now_dt - task_scheduled).days > 30:
                        logger.warning(f"[Worker 3] Task {task_id} scheduled date ({task.scheduled_at}) is > 30 days in the past. Flagging MANUAL_REVIEW.")
                        t_repo = TaskRepository(chk_session)
                        await t_repo.update_status(
                            task_id,
                            TaskStatus.MANUAL_REVIEW,
                            manual_review_reason=f"[STALE_FOLLOWUP] Scheduled date is > 30 days overdue. Operator review recommended."
                        )
                        self.current_task_id = None
                        return

                    # Verify prerequisite outreach message completed before sending Follow-Up 1
                    if task.type == "FOLLOW_UP_1":
                        init_stmt = select(Task).where(
                            and_(Task.contact_id == contact.id, Task.type == "MESSAGE")
                        )
                        init_task = (await chk_session.execute(init_stmt)).scalar_one_or_none()
                        if not init_task or init_task.status != TaskStatus.COMPLETED.value:
                            logger.warning(f"[Worker 3] Cannot send Follow-Up 1 for {contact.name}: Initial outreach message was not completed (status: {getattr(init_task, 'status', 'None')}).")
                            t_repo = TaskRepository(chk_session)
                            await t_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW, manual_review_reason="[INITIAL_MESSAGE_PENDING] Initial outreach message was not completed.")
                            self.current_task_id = None
                            return

                    # Verify Follow-Up 1 completed before sending Follow-Up 2
                    if task.type == "FOLLOW_UP_2":
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

            # ── Chat History Inspection & External Message Segregation ──
            if isinstance(adapter, ExtensionAdapter):
                try:
                    chat_inspect = await adapter.inspect_conversation(worker="outreach")
                    if chat_inspect.get("success") and chat_inspect.get("data"):
                        cdata = chat_inspect["data"]
                        inbound_msgs = cdata.get("inbound_messages", [])
                        outbound_msgs = cdata.get("outbound_messages", [])

                        # 1. Inbound reply check: Contact already replied
                        if inbound_msgs:
                            last_inbound = inbound_msgs[-1]
                            logger.info(f"[Worker 3] Inbound reply detected from {contact.name}: '{last_inbound[:60]}'. Holding task in MANUAL_REVIEW.")
                            async with AsyncSessionLocal() as session:
                                c_repo = ContactRepository(session)
                                await c_repo.update_replied(contact.id, "YES")
                                t_repo = TaskRepository(session)
                                await t_repo.update_status(
                                    task_id,
                                    TaskStatus.MANUAL_REVIEW,
                                    manual_review_reason=f"[REPLY_RECEIVED] Contact replied: '{last_inbound[:70]}...'. Manual verification needed."
                                )
                            self.current_task_id = None
                            return

                        # 2. Outbound external message check: verify messages sent from our end
                        if outbound_msgs:
                            external_msgs = [m for m in outbound_msgs if not is_system_sequence_message(m, contact)]
                            if external_msgs:
                                ext_snippet = external_msgs[-1]
                                logger.warning(f"[Worker 3] External outbound message detected for {contact.name}: '{ext_snippet}'. Flagging MANUAL_REVIEW.")
                                async with AsyncSessionLocal() as session:
                                    t_repo = TaskRepository(session)
                                    await t_repo.update_status(
                                        task_id,
                                        TaskStatus.MANUAL_REVIEW,
                                        manual_review_reason=f"[EXTERNAL_MESSAGE_DETECTED] Message sent from our end not generated by system: '{ext_snippet[:70]}...'. Please verify."
                                    )
                                    c_repo = ContactRepository(session)
                                    curr_notes = contact.notes or ""
                                    if "External message" not in curr_notes:
                                        await c_repo.update(
                                            contact.id,
                                            {"notes": f"{curr_notes} [External message: {ext_snippet[:50]}]".strip()}
                                        )
                                self.current_task_id = None
                                return
                except Exception as ce:
                    logger.warning(f"[Worker 3] Chat history pre-inspection error (proceeding safely): {ce}")

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

            # Pause & Stop Check right before sending
            if self._paused or self._stop_requested:
                logger.info(f"[{WORKER_NAME}] Worker paused/stopped before sending follow-up for task {task_id}.")
                await self._revert_task_to_ready(task_id, cancel_pending_msg=True, msg_id=msg_id)
                return

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
                    await t_repo.update_status(task_id, TaskStatus.SKIPPED, manual_review_reason=f"[DM_RESTRICTED] {send_reason}")
                    c_repo = ContactRepository(session)
                    await c_repo.update(contact.id, {"replied_status": "DM_RESTRICTED", "notes": f"DM Restricted: {send_reason}"})
                    m_repo = MessageRepository(session)
                    await m_repo.update_result(msg_id, "SKIPPED", "DM_RESTRICTED")
                self.current_task_id = None
                return

            if not sent:
                if self._paused or self._stop_requested or "abort" in str(send_reason).lower():
                    logger.info(f"[{WORKER_NAME}] Follow-up send aborted or worker paused/stopped for task {task_id}. Reverting to READY.")
                    await self._revert_task_to_ready(task_id, cancel_pending_msg=True, msg_id=msg_id)
                    return
                logger.warning(f"[{WORKER_NAME}] Follow-up send failed for task {task_id}: {send_reason}")
                await self._fail_task(task_id, ResultCode.SEND_FAILED, send_reason or "Send failed", new_status=TaskStatus.FAILED)
                return

            # ── Confirm Result ──
            self.stage = AutomationStage.DETECTING_RESULT
            result = await adapter.detect_result(followup_body)

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
                    m_repo = MessageRepository(session)
                    await m_repo.update_result(msg_id, "SENT", "SUCCESS")
                    t_repo = TaskRepository(session)
                    await t_repo.update_status(task_id, TaskStatus.COMPLETED, run_id=self.current_run_id)

                    chk_c = await session.get(Contact, contact.id)
                    if chk_c and self.current_run_id:
                        chk_c.last_run_id = self.current_run_id

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
                            details=f"Sent {task.type} successfully",
                            run_id=self.current_run_id
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
                    await t_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW, manual_review_reason="[RATE_LIMITED] Instagram action temporarily restricted. Pacing delay required.")
                await self.pause()

            self.current_task_id = None

        except Exception as e:
            logger.error(f"[Worker 3] Error processing task {task_id}: {e}")
            async with AsyncSessionLocal() as session:
                t_repo = TaskRepository(session)
                await t_repo.update_status(task_id, TaskStatus.RETRY_WAIT, manual_review_reason=f"[ERROR] {str(e)}")
            self.current_task_id = None

followup_worker = FollowUpWorker()
