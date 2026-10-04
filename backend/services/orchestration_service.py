"""
Authoritative Orchestration Service:
Connects all components end-to-end:
Source -> SourceRecord -> Contact -> Task -> Claim (with lease)
-> Verification -> Approval Gate -> Send -> Result Detection
-> Reconciliation -> Follow-up Scheduling -> Reply Detection -> Cancellation.
"""
import logging
from typing import Optional, Dict, Any, Tuple
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from backend.database.models import Task, Contact, Message, Event
from backend.repositories.task_repository import TaskRepository
from backend.repositories.contact_repository import ContactRepository
from backend.verification.verification_service import VerificationService
from backend.followups.service import FollowUpService
from backend.recovery.recovery_service import RecoveryService
from backend.domain.enums import TaskStatus, ResultCode, EventCode, VerificationDecision
from backend.events.event_bus import event_bus
from backend.config.settings import settings

logger = logging.getLogger(__name__)

class OrchestrationService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.task_repo = TaskRepository(session)
        self.contact_repo = ContactRepository(session)
        self.verification_service = VerificationService()
        self.recovery_service = RecoveryService(session)

    async def claim_task(self, worker_id: str) -> Optional[Task]:
        """Claim next ready task with atomic lease ownership."""
        task = await self.task_repo.claim_next_ready(worker_id)
        if task:
            await event_bus.publish(EventCode.TASK_CLAIMED, task_id=task.id, worker_id=worker_id)
        return task

    async def verify_identity(self, task_id: str, extracted_data: Dict[str, Any]) -> Tuple[bool, VerificationDecision, str]:
        """Execute identity verification gate."""
        task = await self.task_repo.get_by_id(task_id)
        if not task or not task.contact:
            return False, VerificationDecision.UNKNOWN, "Task or contact not found"

        expected = {
            "instagram_url": task.contact.instagram_url,
            "username": task.contact.username,
            "name": task.contact.name,
            "expected_followers": task.contact.expected_followers
        }
        output = await self.verification_service.decide(expected, extracted_data)

        if output.decision == VerificationDecision.HIGH_CONFIDENCE:
            await event_bus.publish(EventCode.PROFILE_VERIFIED, task_id=task_id, payload={"confidence": output.confidence})
            return True, output.decision, output.reason

        if output.decision == VerificationDecision.MEDIUM_CONFIDENCE:
            # Policy gate: requires manual approval
            await self.task_repo.update_status(task_id, TaskStatus.AWAITING_APPROVAL)
            await event_bus.publish(EventCode.MANUAL_REVIEW_REQUIRED, task_id=task_id, payload={"reason": output.reason})
            return False, output.decision, output.reason

        # Low confidence, mismatch, or unknown -> fail-closed
        await self.task_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW)
        await event_bus.publish(EventCode.TASK_FAILED, task_id=task_id, payload={"reason": output.reason, "decision": output.decision.value})
        return False, output.decision, output.reason

    async def approve_task(self, task_id: str, approved_by: str = "operator") -> bool:
        """Dashboard approval of a task awaiting approval."""
        task = await self.task_repo.approve_task(task_id, approved_by=approved_by)
        if task:
            await event_bus.publish(EventCode.MESSAGE_APPROVED, task_id=task_id, payload={"approved_by": approved_by})
            return True
        return False

    async def reject_task(self, task_id: str, reason: str = "Rejected by operator") -> bool:
        """Dashboard rejection of a task awaiting approval."""
        task = await self.task_repo.reject_task(task_id, reason=reason)
        if task:
            await event_bus.publish(EventCode.MESSAGE_REJECTED, task_id=task_id, payload={"reason": reason})
            return True
        return False

    async def handle_send_result(
        self,
        task_id: str,
        msg_id: str,
        result_code: ResultCode,
        worker_id: str,
        adapter=None
    ) -> str:
        """Handle send result deterministically."""
        now = datetime.now(timezone.utc)
        task = await self.task_repo.get_by_id(task_id)
        if not task:
            return "TASK_NOT_FOUND"

        msg_stmt = select(Message).where(Message.id == msg_id)
        msg = (await self.session.execute(msg_stmt)).scalar_one_or_none()

        if result_code == ResultCode.SUCCESS:
            if msg:
                msg.status = "SENT"
                msg.confirmed_at = now
            await self.task_repo.update_status(task_id, TaskStatus.COMPLETED, worker_id=worker_id)

            # Schedule follow-up if applicable
            if task.type == "MESSAGE":
                await FollowUpService.schedule_followup(self.session, task.contact_id, "FOLLOW_UP_1")
            elif task.type == "FOLLOW_UP_1":
                await FollowUpService.schedule_followup(self.session, task.contact_id, "FOLLOW_UP_2")

            await self.session.commit()
            await event_bus.publish(EventCode.SEND_CONFIRMED, task_id=task_id, worker_id=worker_id)
            return "COMPLETED"

        elif result_code in {ResultCode.SEND_UNKNOWN, ResultCode.UNKNOWN}:
            if msg:
                msg.status = "UNKNOWN"
            await self.task_repo.update_status(task_id, TaskStatus.RECONCILING, worker_id=worker_id)
            await self.session.commit()
            await event_bus.publish(EventCode.SEND_UNKNOWN, task_id=task_id, worker_id=worker_id)

            # Attempt immediate conversation reconciliation
            rec_outcome = await self.recovery_service.reconcile_task_with_conversation(task_id, adapter)
            return f"RECONCILED_{rec_outcome}"

        elif result_code in {ResultCode.RATE_LIMITED, ResultCode.ACTION_BLOCKED}:
            if msg:
                msg.status = "FAILED"
            await self.task_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW, worker_id=worker_id)
            await self.session.commit()
            await event_bus.publish(EventCode.MANUAL_REVIEW_REQUIRED, task_id=task_id, payload={"reason": result_code.value})
            return "MANUAL_REVIEW"

        else:
            if msg:
                msg.status = "FAILED"
            await self.task_repo.update_status(task_id, TaskStatus.MANUAL_REVIEW, worker_id=worker_id)
            await self.session.commit()
            await event_bus.publish(EventCode.SEND_FAILED, task_id=task_id, payload={"code": result_code.value})
            return "FAILED"

    async def process_reply(self, contact_id: str, replied_status: str) -> Dict[str, Any]:
        """
        Transactional reply processing:
        Updates contact, cancels pending follow-ups if YES, prevents reopening if NO, logs events.
        """
        contact = await self.contact_repo.update_replied(contact_id, replied_status)
        if not contact:
            return {"status": "error", "message": "Contact not found"}

        cancelled_count = 0
        if replied_status == "YES":
            cancelled_count = await FollowUpService.cancel_pending_followups(
                self.session, contact_id, reason="Contact replied YES"
            )

        return {
            "contact_id": contact_id,
            "replied_status": contact.replied_status,
            "cancelled_followups": cancelled_count,
            "status": "success"
        }
