import pytest
from datetime import datetime, timezone, timedelta
from backend.database.models import Contact, Task
from backend.repositories.contact_repository import ContactRepository
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from backend.database.models import Base

@pytest.fixture
async def async_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with session_factory() as session:
        yield session
    await engine.dispose()

@pytest.mark.asyncio
async def test_update_bulk_templates_and_reschedule(async_db):
    repo = ContactRepository(async_db)
    c1 = await repo.create(name="Alpha", instagram_url="https://instagram.com/alpha", username="alpha")
    
    # Add initial completed task
    msg_task = Task(
        contact_id=c1.id,
        type="MESSAGE",
        status="COMPLETED",
        completed_at=datetime.now(timezone.utc) - timedelta(days=1)
    )
    fu1_task = Task(
        contact_id=c1.id,
        type="FOLLOW_UP_1",
        status="READY",
        scheduled_at=datetime.now(timezone.utc) + timedelta(days=10)
    )
    async_db.add_all([msg_task, fu1_task])
    await async_db.commit()

    # Update template with 4 days delay and reschedule_existing=True
    res = await repo.update_bulk_templates(
        default_message="Bulk message",
        followup_1_delay_days=4,
        reschedule_existing=True
    )
    assert res["updated_contacts_count"] >= 1
    assert res["rescheduled_tasks_count"] >= 1

    await async_db.refresh(fu1_task)
    # Check that fu1_task scheduled_at is approximately msg_task.completed_at + 4 days
    diff = fu1_task.scheduled_at.replace(tzinfo=timezone.utc) - msg_task.completed_at.replace(tzinfo=timezone.utc)
    assert abs(diff.total_seconds() - 4 * 86400) < 60

@pytest.mark.asyncio
async def test_update_contact_followup_schedule(async_db):
    repo = ContactRepository(async_db)
    c1 = await repo.create(name="Beta", instagram_url="https://instagram.com/beta", username="beta")

    custom_dt = datetime.now(timezone.utc) + timedelta(days=7)
    updated = await repo.update_followup_schedule(
        contact_id=c1.id,
        followup_1_scheduled_at=custom_dt,
        followup_1_status="PAUSED",
        followup_1_delay_days=7
    )
    assert updated is not None
    assert updated.followup_1_delay_days == 7

    # Check task was created with PAUSED status
    from sqlalchemy import select, and_
    task = (await async_db.execute(
        select(Task).where(and_(Task.contact_id == c1.id, Task.type == "FOLLOW_UP_1"))
    )).scalar_one_or_none()
    assert task is not None
    assert task.status == "PAUSED"
