import pytest
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from backend.database.models import Contact, Task, Message
from backend.repositories.contact_repository import ContactRepository
from backend.repositories.task_repository import TaskRepository
from backend.followups.service import FollowUpService
from backend.domain.enums import TaskStatus

async def complete_task(session: AsyncSession, task_repo: TaskRepository, task_id: str):
    await task_repo.update_status(task_id, TaskStatus.RUNNING)
    await task_repo.update_status(task_id, TaskStatus.SENDING)
    await task_repo.update_status(task_id, TaskStatus.COMPLETED)

@pytest.mark.asyncio
async def test_reply_yes_atomically_cancels_pending_followups(test_session: AsyncSession):
    contact_repo = ContactRepository(test_session)
    task_repo = TaskRepository(test_session)

    contact = await contact_repo.create(
        name="Reply User",
        instagram_url="https://instagram.com/replyuser/",
        username="replyuser"
    )

    # Initial message completed via valid lifecycle
    init_task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await complete_task(test_session, task_repo, init_task.id)

    # Message record marked SENT
    msg = Message(contact_id=contact.id, task_id=init_task.id, body="Hi", status="SENT")
    test_session.add(msg)
    await test_session.commit()

    # Schedule Follow-Up 1 and Follow-Up 2
    fu1 = await FollowUpService.schedule_followup(test_session, contact.id, "FOLLOW_UP_1", delay_days=2)
    assert fu1 is not None
    assert fu1.status == TaskStatus.READY.value

    # Now contact replies YES
    updated_contact = await contact_repo.update_replied(contact.id, "YES")
    assert updated_contact.replied_status == "YES"
    assert updated_contact.replied_at is not None

    # Verify FU1 is CANCELLED atomically in the DB
    refreshed_fu1 = await task_repo.get_by_id(fu1.id)
    assert refreshed_fu1.status == TaskStatus.CANCELLED.value
    assert "Cancelled: Contact replied YES" in refreshed_fu1.manual_review_reason

@pytest.mark.asyncio
async def test_reply_yes_blocks_future_followup_creation(test_session: AsyncSession):
    contact_repo = ContactRepository(test_session)
    task_repo = TaskRepository(test_session)

    contact = await contact_repo.create(
        name="No FU User",
        instagram_url="https://instagram.com/nofuuser/",
        username="nofuuser"
    )
    init_task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await complete_task(test_session, task_repo, init_task.id)
    msg = Message(contact_id=contact.id, task_id=init_task.id, body="Hi", status="SENT")
    test_session.add(msg)
    await test_session.commit()

    # Contact replies YES
    await contact_repo.update_replied(contact.id, "YES")

    # Attempt to schedule FU1
    fu = await FollowUpService.schedule_followup(test_session, contact.id, "FOLLOW_UP_1")
    assert fu is None  # Blocked!

@pytest.mark.asyncio
async def test_reply_yes_during_fu_execution_race_check(test_session: AsyncSession):
    """
    Race condition: Follow-up was already claimed/scheduled, but contact replied YES
    right before the worker sends the message. verify_before_send must catch it and cancel.
    """
    contact_repo = ContactRepository(test_session)
    task_repo = TaskRepository(test_session)

    contact = await contact_repo.create(
        name="Race User",
        instagram_url="https://instagram.com/raceuser/",
        username="raceuser"
    )
    init_task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await complete_task(test_session, task_repo, init_task.id)
    msg = Message(contact_id=contact.id, task_id=init_task.id, body="Hi", status="SENT")
    test_session.add(msg)
    await test_session.commit()

    fu = await FollowUpService.schedule_followup(test_session, contact.id, "FOLLOW_UP_1")
    assert fu is not None

    # Simulate contact replies YES
    contact.replied_status = "YES"
    await test_session.commit()

    # Immediately before sending, worker invokes verify_before_send
    safe, reason = await FollowUpService.verify_before_send(test_session, fu.id)
    assert safe is False
    assert "Contact has replied YES" in reason

    # Task should be transitioned to CANCELLED
    cancelled_fu = await task_repo.get_by_id(fu.id)
    assert cancelled_fu.status == TaskStatus.CANCELLED.value

@pytest.mark.asyncio
async def test_yes_to_no_transition_does_not_reopen_followups(test_session: AsyncSession):
    """
    Invariant: YES -> NO transition must NOT silently reopen cancelled follow-ups.
    """
    contact_repo = ContactRepository(test_session)
    task_repo = TaskRepository(test_session)

    contact = await contact_repo.create(
        name="Toggle User",
        instagram_url="https://instagram.com/toggleuser/",
        username="toggleuser"
    )
    init_task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await complete_task(test_session, task_repo, init_task.id)
    msg = Message(contact_id=contact.id, task_id=init_task.id, body="Hi", status="SENT")
    test_session.add(msg)
    await test_session.commit()

    fu = await FollowUpService.schedule_followup(test_session, contact.id, "FOLLOW_UP_1")
    assert fu is not None

    # Transition to YES cancels the follow-up
    await contact_repo.update_replied(contact.id, "YES")
    fu_after_yes = await task_repo.get_by_id(fu.id)
    assert fu_after_yes.status == TaskStatus.CANCELLED.value

    # Transition from YES to NO
    await contact_repo.update_replied(contact.id, "NO")
    fu_after_no = await task_repo.get_by_id(fu.id)
    assert fu_after_no.status == TaskStatus.CANCELLED.value  # MUST remain CANCELLED

@pytest.mark.asyncio
async def test_followup_idempotency_prevents_duplicate_tasks(test_session: AsyncSession):
    contact_repo = ContactRepository(test_session)
    task_repo = TaskRepository(test_session)

    contact = await contact_repo.create(
        name="Idem User",
        instagram_url="https://instagram.com/idemuser/",
        username="idemuser"
    )
    init_task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await complete_task(test_session, task_repo, init_task.id)
    msg = Message(contact_id=contact.id, task_id=init_task.id, body="Hi", status="SENT")
    test_session.add(msg)
    await test_session.commit()

    # Schedule FU1 first time
    fu_1 = await FollowUpService.schedule_followup(test_session, contact.id, "FOLLOW_UP_1")
    assert fu_1 is not None

    # Schedule FU1 second time
    fu_2 = await FollowUpService.schedule_followup(test_session, contact.id, "FOLLOW_UP_1")
    # Must return existing task and NOT create a new one
    assert fu_2 is not None or fu_2 == fu_1

    # Check total follow-up tasks for this contact
    stmt = select(Task).where(and_(Task.contact_id == contact.id, Task.type == "FOLLOW_UP_1"))
    all_fu = (await test_session.execute(stmt)).scalars().all()
    assert len(all_fu) == 1

@pytest.mark.asyncio
async def test_unknown_initial_send_prevents_followup(test_session: AsyncSession):
    """
    Invariant: Never create a follow-up from an UNKNOWN initial send.
    """
    contact_repo = ContactRepository(test_session)
    task_repo = TaskRepository(test_session)

    contact = await contact_repo.create(
        name="Unknown User",
        instagram_url="https://instagram.com/unknownuser/",
        username="unknownuser"
    )
    init_task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await task_repo.update_status(init_task.id, TaskStatus.RUNNING)
    await task_repo.update_status(init_task.id, TaskStatus.SENDING)
    await task_repo.update_status(init_task.id, TaskStatus.RECONCILING)

    # Initial message status is UNKNOWN
    msg = Message(contact_id=contact.id, task_id=init_task.id, body="Hi", status="UNKNOWN")
    test_session.add(msg)
    await test_session.commit()

    # Attempt to schedule follow-up
    fu = await FollowUpService.schedule_followup(test_session, contact.id, "FOLLOW_UP_1")
    assert fu is None  # Blocked!
