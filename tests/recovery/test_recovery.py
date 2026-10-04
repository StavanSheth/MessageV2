import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Contact, Task, Message, SendAttempt
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

@pytest.mark.asyncio
async def test_db_failure_after_send_click_reconciles_on_restart(test_session: AsyncSession):
    """
    Scenario P0.2:
    1. Prepare message
    2. Persist send attempt
    3. Click Send / Instagram accepts message
    4. DB commit fails / crash before status updated to COMPLETED
    5. Application restarts
    6. System MUST NOT auto-retry; task transitions to RECONCILING
    7. Conversation inspection finds message -> reconciles to CONFIRMED / SENT
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="DB Crash Target",
        instagram_url="https://instagram.com/dbcrash/",
        username="dbcrash",
        message="Important outreach payload"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")

    # 1. Prepare message & 2. Persist send attempt
    msg = Message(
        contact_id=contact.id,
        task_id=task.id,
        sequence=1,
        body="Important outreach payload",
        status="PENDING"
    )
    test_session.add(msg)
    await test_session.flush()

    attempt = SendAttempt(
        task_id=task.id,
        message_id=msg.id,
        attempt_id="att-test-p02",
        contact_id=contact.id,
        message_body="Important outreach payload",
        worker_id="WORKER-01",
        browser_session_id="browser-session-999",
        status="REQUESTED"
    )
    test_session.add(attempt)

    task.status = TaskStatus.SENDING.value
    task.send_attempt_id = "att-test-p02"
    task.send_requested_at = datetime.now(timezone.utc)
    await test_session.commit()

    # 3. Instagram accepts message, but app crashes before task completion commit
    # 4. App restarts: RecoveryService.reconcile_on_startup
    recovery = RecoveryService(test_session)
    startup_res = await recovery.reconcile_on_startup()

    # Invariant: Must NOT be reset to READY! Must enter RECONCILING!
    assert task.id in startup_res["reconciling"]
    assert task.id not in startup_res["reset_to_ready"]

    refreshed_task = await task_repo.get_by_id(task.id)
    assert refreshed_task.status == TaskStatus.RECONCILING.value
    assert refreshed_task.reconciliation_status == "PENDING_CONVERSATION_INSPECTION"

    # 5. Worker reconciles task via conversation inspection
    mock_adapter = AsyncMock()
    mock_adapter.inspect_conversation = AsyncMock(return_value=ResultCode.SUCCESS)

    reconciliation_outcome = await recovery.reconcile_task_with_conversation(
        task_id=task.id,
        adapter=mock_adapter,
        expected_text="Important outreach payload"
    )

    assert reconciliation_outcome == "CONFIRMED"
    final_task = await task_repo.get_by_id(task.id)
    assert final_task.status == TaskStatus.COMPLETED.value
    assert final_task.reconciliation_status == "CONFIRMED_SENT"

    # Message must be marked SENT
    msg_stmt = select(Message).where(Message.id == msg.id)
    final_msg = (await test_session.execute(msg_stmt)).scalar_one()
    assert final_msg.status == "SENT"
