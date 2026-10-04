import pytest
import asyncio
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database.models import Contact, Task, Message
from backend.repositories.task_repository import TaskRepository
from backend.repositories.contact_repository import ContactRepository
from backend.followups.service import FollowUpService
from backend.domain.enums import TaskStatus

@pytest.mark.asyncio
async def test_concurrent_worker_claim_only_one_succeeds(test_session: AsyncSession):
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Concurrent User",
        instagram_url="https://instagram.com/concurrent/",
        username="concurrent"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await test_session.commit()

    # Simulate two workers attempting to claim the same task
    claim_1 = await task_repo.claim_next_ready(worker_id="WORKER-1")
    claim_2 = await task_repo.claim_next_ready(worker_id="WORKER-2")

    assert claim_1 is not None
    assert claim_1.id == task.id
    assert claim_1.lease_owner == "WORKER-1"

    # Worker 2 must receive None
    assert claim_2 is None

@pytest.mark.asyncio
async def test_stale_worker_cannot_modify_active_leased_task(test_session: AsyncSession):
    """
    INVARIANT: NO STALE WORKER -> TASK MODIFICATION.
    If Worker 1 lost its lease or Worker 2 owns the task, Worker 1 cannot update the task status.
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Stale User",
        instagram_url="https://instagram.com/staleuser/",
        username="staleuser"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")

    # Worker 2 holds the active lease
    claimed = await task_repo.claim_next_ready(worker_id="WORKER-2", lease_duration_seconds=120)
    assert claimed.lease_owner == "WORKER-2"

    # Stale Worker 1 attempts to update task status
    with pytest.raises(PermissionError) as exc_info:
        await task_repo.update_status(task.id, TaskStatus.VERIFYING, worker_id="WORKER-1")

    assert "Cannot modify task" in str(exc_info.value)
    assert "owned by WORKER-2" in str(exc_info.value)

@pytest.mark.asyncio
async def test_concurrent_followup_scheduling_race(test_engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
    sm = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

    async with sm() as session1:
        contact_repo = ContactRepository(session1)
        task_repo = TaskRepository(session1)
        contact = await contact_repo.create(
            name="FU Race User",
            instagram_url="https://instagram.com/furace/",
            username="furace"
        )
        task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
        await task_repo.update_status(task.id, TaskStatus.RUNNING)
        await task_repo.update_status(task.id, TaskStatus.SENDING)
        await task_repo.update_status(task.id, TaskStatus.COMPLETED)

        msg = Message(contact_id=contact.id, task_id=task.id, body="Hi", status="SENT")
        session1.add(msg)
        await session1.commit()
        contact_id = contact.id

    async def schedule():
        async with sm() as s:
            return await FollowUpService.schedule_followup(s, contact_id, "FOLLOW_UP_1")

    res1, res2 = await asyncio.gather(schedule(), schedule())

    async with sm() as session_verify:
        all_fu = (await session_verify.execute(
            select(Task).where(Task.contact_id == contact_id, Task.type == "FOLLOW_UP_1")
        )).scalars().all()
        assert len(all_fu) == 1
