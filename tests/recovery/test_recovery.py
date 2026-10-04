import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Contact, Task, Message
from backend.repositories.task_repository import TaskRepository
from backend.repositories.contact_repository import ContactRepository
from backend.recovery.recovery_service import RecoveryService
from backend.domain.enums import TaskStatus, ResultCode

@pytest.mark.asyncio
async def test_startup_recovery_interrupted_sending_task(test_session: AsyncSession):
    """
    Simulate process kill during SENDING:
    On startup, reconcile_on_startup must move this task to RECONCILING,
    NEVER convert it to READY.
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Kill Sending User",
        instagram_url="https://instagram.com/killsend/",
        username="killsend"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await task_repo.update_status(task.id, TaskStatus.RUNNING)
    await task_repo.update_status(task.id, TaskStatus.SENDING)

    msg = Message(contact_id=contact.id, task_id=task.id, body="Hey", status="PENDING")
    test_session.add(msg)
    await test_session.commit()

    # Application terminates abruptly and starts up again
    recovery = RecoveryService(test_session)
    result = await recovery.reconcile_on_startup()

    assert task.id in result["reconciling"]
    refreshed_task = await task_repo.get_by_id(task.id)
    assert refreshed_task.status == TaskStatus.RECONCILING.value
    assert refreshed_task.reconciliation_status == "PENDING_CONVERSATION_INSPECTION"

@pytest.mark.asyncio
async def test_conversation_reconciliation_confirmed_sent(test_session: AsyncSession):
    """
    When reconciling an interrupted task, if the message is visible in the conversation,
    the task must be confirmed and completed.
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Reconcile Sent User",
        instagram_url="https://instagram.com/recsent/",
        username="recsent"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await task_repo.update_status(task.id, TaskStatus.RUNNING)
    await task_repo.update_status(task.id, TaskStatus.SENDING)
    await task_repo.update_status(task.id, TaskStatus.RECONCILING)

    msg = Message(contact_id=contact.id, task_id=task.id, body="Special Offer", status="UNKNOWN")
    test_session.add(msg)
    await test_session.commit()

    # Mock adapter returns SUCCESS (message bubble visible)
    fake_adapter = AsyncMock()
    fake_adapter.inspect_conversation.return_value = ResultCode.SUCCESS

    recovery = RecoveryService(test_session)
    outcome = await recovery.reconcile_task_with_conversation(task.id, fake_adapter, expected_text="Special Offer")
    assert outcome == "CONFIRMED"

    refreshed_task = await task_repo.get_by_id(task.id)
    assert refreshed_task.status == TaskStatus.COMPLETED.value
    assert refreshed_task.reconciliation_status == "CONFIRMED_SENT"

@pytest.mark.asyncio
async def test_conversation_reconciliation_confirmed_not_sent(test_session: AsyncSession):
    """
    If inspection confirms message was NOT sent, task is safely returned to READY.
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Reconcile Not Sent User",
        instagram_url="https://instagram.com/recnotsent/",
        username="recnotsent"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await task_repo.update_status(task.id, TaskStatus.RUNNING)
    await task_repo.update_status(task.id, TaskStatus.SENDING)
    await task_repo.update_status(task.id, TaskStatus.RECONCILING)

    fake_adapter = AsyncMock()
    fake_adapter.inspect_conversation.return_value = ResultCode.SEND_FAILED

    recovery = RecoveryService(test_session)
    outcome = await recovery.reconcile_task_with_conversation(task.id, fake_adapter, expected_text="Hello")
    assert outcome == "NOT_SENT"

    refreshed_task = await task_repo.get_by_id(task.id)
    assert refreshed_task.status == TaskStatus.READY.value

@pytest.mark.asyncio
async def test_conversation_reconciliation_ambiguous_enters_manual_review(test_session: AsyncSession):
    """
    If conversation inspection outcome is ambiguous, move task to MANUAL_REVIEW.
    Never guess or automatically retry!
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Ambiguous User",
        instagram_url="https://instagram.com/ambig/",
        username="ambig"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await task_repo.update_status(task.id, TaskStatus.RUNNING)
    await task_repo.update_status(task.id, TaskStatus.SENDING)
    await task_repo.update_status(task.id, TaskStatus.RECONCILING)

    fake_adapter = AsyncMock()
    fake_adapter.inspect_conversation.return_value = ResultCode.SEND_UNKNOWN

    recovery = RecoveryService(test_session)
    outcome = await recovery.reconcile_task_with_conversation(task.id, fake_adapter, expected_text="Hello")
    assert outcome == "MANUAL_REVIEW"

    refreshed_task = await task_repo.get_by_id(task.id)
    assert refreshed_task.status == TaskStatus.MANUAL_REVIEW.value

@pytest.mark.asyncio
async def test_worker_lease_expiration_and_safe_takeover(test_session: AsyncSession):
    """
    If Worker A crashed and its lease expires, Worker B must safely take over the task.
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Lease User",
        instagram_url="https://instagram.com/leaseuser/",
        username="leaseuser"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")

    # Worker A claims task with 1-second lease
    claimed_a = await task_repo.claim_next_ready(worker_id="WORKER-A", lease_duration_seconds=1)
    assert claimed_a is not None
    assert claimed_a.lease_owner == "WORKER-A"

    # Immediately, Worker B cannot claim it
    claimed_b_immediate = await task_repo.claim_next_ready(worker_id="WORKER-B")
    assert claimed_b_immediate is None

    # Simulate lease expiration in DB
    now = datetime.now(timezone.utc)
    task.lease_expires_at = now - timedelta(seconds=10)
    await test_session.commit()

    # Now Worker B can safely take over the expired lease
    claimed_b = await task_repo.claim_next_ready(worker_id="WORKER-B", lease_duration_seconds=120)
    assert claimed_b is not None
    assert claimed_b.id == task.id
    assert claimed_b.lease_owner == "WORKER-B"
