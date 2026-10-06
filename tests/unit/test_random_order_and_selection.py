import pytest
from datetime import datetime, timezone
from backend.database.session import AsyncSessionLocal
from backend.repositories.task_repository import TaskRepository
from backend.database.models import Contact, Task
from backend.domain.enums import TaskStatus

@pytest.mark.asyncio
async def test_claim_next_ready_random_order():
    async with AsyncSessionLocal() as session:
        repo = TaskRepository(session)

        # Create 3 contacts, each with 1 task of unique type
        c1 = Contact(name="Test User Random 1", instagram_url="https://instagram.com/test_user_random_1")
        c2 = Contact(name="Test User Random 2", instagram_url="https://instagram.com/test_user_random_2")
        c3 = Contact(name="Test User Random 3", instagram_url="https://instagram.com/test_user_random_3")
        session.add_all([c1, c2, c3])
        await session.commit()
        await session.refresh(c1)
        await session.refresh(c2)
        await session.refresh(c3)

        t1 = await repo.create(c1.id, task_type="TEST_RANDOM", priority=1)
        t2 = await repo.create(c2.id, task_type="TEST_RANDOM", priority=1)
        t3 = await repo.create(c3.id, task_type="TEST_RANDOM", priority=1)

        # Claim with random_order=True
        claimed = await repo.claim_next_ready("WORKER-TEST", task_types=["TEST_RANDOM"], random_order=True)
        assert claimed is not None
        assert claimed.id in [t1.id, t2.id, t3.id]
        assert claimed.status == TaskStatus.RUNNING.value

        # Test bulk_set_selection: deselect remaining tasks (pause them)
        remaining_ids = [t.id for t in [t1, t2, t3] if t.id != claimed.id]
        updated_count = await repo.bulk_set_selection(remaining_ids, selected=False)
        assert updated_count == len(remaining_ids)

        for rid in remaining_ids:
            task_obj = await repo.get_by_id(rid)
            assert task_obj.status == TaskStatus.PAUSED.value

        # When remaining tasks are PAUSED, claim_next_ready should return None!
        none_claimed = await repo.claim_next_ready("WORKER-TEST", task_types=["TEST_RANDOM"], random_order=True)
        assert none_claimed is None

        # Now re-select them
        updated_count = await repo.bulk_set_selection(remaining_ids, selected=True)
        assert updated_count == len(remaining_ids)

        for rid in remaining_ids:
            task_obj = await repo.get_by_id(rid)
            assert task_obj.status == TaskStatus.READY.value

        # Now claim_next_ready should succeed again
        re_claimed = await repo.claim_next_ready("WORKER-TEST", task_types=["TEST_RANDOM"], random_order=True)
        assert re_claimed is not None
        assert re_claimed.id in remaining_ids

        # Clean up
        await repo.delete(t1.id)
        await repo.delete(t2.id)
        await repo.delete(t3.id)
        await session.delete(c1)
        await session.delete(c2)
        await session.delete(c3)
        await session.commit()
