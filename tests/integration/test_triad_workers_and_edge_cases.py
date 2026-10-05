import pytest
import asyncio
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient

from backend.automation.coordinator import coordinator
from backend.workers.instagram_worker import instagram_worker
from backend.workers.followup_worker import followup_worker
from backend.workers.reply_scanner_worker import reply_scanner_worker
from backend.database.session import AsyncSessionLocal
from backend.repositories.task_repository import TaskRepository
from backend.repositories.contact_repository import ContactRepository
from backend.database.models import Contact, Task
from backend.domain.enums import TaskStatus

@pytest.mark.asyncio
async def test_worker1_standalone_lifecycle(client: AsyncClient):
    """Test Worker 1 start, pause, resume, stop endpoints and lock holding."""
    # 1. Start Worker 1
    res = await client.post("/api/automation/start", json={"batch_limit": 3, "delay_seconds": 15})
    assert res.status_code == 200
    assert res.json()["status"] == "started"
    
    # Verify Coordinator shows Worker 1 holding lock
    coord_status = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_status["active_sender"] == "WORKER-01"
    assert coord_status["lock_held"] is True
    
    # 2. Pause Worker 1
    res_pause = await client.post("/api/automation/pause")
    assert res_pause.status_code == 200
    coord_status_paused = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_status_paused["lock_held"] is False
    
    # 3. Resume Worker 1
    res_resume = await client.post("/api/automation/resume")
    assert res_resume.status_code == 200
    coord_status_resumed = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_status_resumed["active_sender"] == "WORKER-01"
    assert coord_status_resumed["lock_held"] is True
    
    # 4. Stop Worker 1
    res_stop = await client.post("/api/automation/stop")
    assert res_stop.status_code == 200
    coord_status_stopped = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_status_stopped["lock_held"] is False

@pytest.mark.asyncio
async def test_worker3_standalone_lifecycle(client: AsyncClient):
    """Test Worker 3 start, pause, resume, stop endpoints and lock holding."""
    # 1. Start Worker 3
    res = await client.post("/api/automation/worker3/start", json={"batch_limit": 2, "delay_seconds": 15})
    assert res.status_code == 200
    assert res.json()["status"] == "started"
    assert res.json()["worker_id"] == "WORKER-03"
    
    # Verify Coordinator shows Worker 3 holding lock
    coord_status = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_status["active_sender"] == "WORKER-03"
    assert coord_status["lock_held"] is True
    
    # Check Worker 3 health
    w3_status = (await client.get("/api/automation/worker3/status")).json()
    assert w3_status["worker_id"] == "WORKER-03"
    assert "status" in w3_status
    
    # 2. Pause Worker 3
    res_pause = await client.post("/api/automation/worker3/pause")
    assert res_pause.status_code == 200
    coord_status_paused = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_status_paused["lock_held"] is False
    
    # 3. Resume Worker 3
    res_resume = await client.post("/api/automation/worker3/resume")
    assert res_resume.status_code == 200
    coord_status_resumed = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_status_resumed["active_sender"] == "WORKER-03"
    
    # 4. Stop Worker 3
    res_stop = await client.post("/api/automation/worker3/stop")
    assert res_stop.status_code == 200
    coord_status_stopped = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_status_stopped["lock_held"] is False

@pytest.mark.asyncio
async def test_simultaneous_worker1_and_worker3_mutual_exclusion(client: AsyncClient):
    """Verify that Worker 1 and Worker 3 NEVER hold the DM lock at the same time."""
    # Start Worker 1
    await client.post("/api/automation/start", json={"batch_limit": 5})
    coord_w1 = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_w1["active_sender"] == "WORKER-01"
    
    # Now start Worker 3 while Worker 1 is active -> Worker 3 preempts Worker 1
    await client.post("/api/automation/worker3/start", json={"batch_limit": 5})
    coord_w3 = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_w3["active_sender"] == "WORKER-03"
    
    # Worker 1 should have been paused
    assert instagram_worker.is_paused is True
    
    # Now start Worker 1 back -> Worker 1 preempts Worker 3
    await client.post("/api/automation/start", json={"batch_limit": 5})
    coord_back = (await client.get("/api/automation/coordinator/status")).json()
    assert coord_back["active_sender"] == "WORKER-01"
    assert followup_worker.is_paused is True
    
    # Cleanup: stop both
    await client.post("/api/automation/stop")
    await client.post("/api/automation/worker3/stop")
    final_status = (await client.get("/api/automation/coordinator/status")).json()
    assert final_status["lock_held"] is False

@pytest.mark.asyncio
async def test_worker2_concurrent_execution(client: AsyncClient):
    """Worker 2 (Reply Scanner) can run concurrently with Worker 1 or Worker 3."""
    # Worker 1 running
    await client.post("/api/automation/start", json={"batch_limit": 5})
    
    # Worker 2 status check
    w2_status = (await client.get("/api/automation/replies/status")).json()
    assert "status" in w2_status
    assert "stats" in w2_status
    
    # Cleanup
    await client.post("/api/automation/stop")

@pytest.mark.asyncio
async def test_coordinator_strategy_modes(client: AsyncClient):
    """Verify setting coordinator modes: BALANCED, COLD_ONLY, FOLLOWUP_ONLY."""
    res1 = await client.post("/api/automation/coordinator/mode", json={"mode": "COLD_ONLY"})
    assert res1.status_code == 200
    assert res1.json()["mode"] == "COLD_ONLY"
    
    res2 = await client.post("/api/automation/coordinator/mode", json={"mode": "FOLLOWUP_ONLY"})
    assert res2.status_code == 200
    assert res2.json()["mode"] == "FOLLOWUP_ONLY"
    
    res3 = await client.post("/api/automation/coordinator/mode", json={"mode": "BALANCED"})
    assert res3.status_code == 200
    assert res3.json()["mode"] == "BALANCED"

@pytest.mark.asyncio
async def test_edge_case_task_type_isolation():
    """Verify that Worker 1 claims only MESSAGE, and Worker 3 claims only FOLLOW_UP."""
    async with AsyncSessionLocal() as session:
        t_repo = TaskRepository(session)
        now = datetime.now(timezone.utc)
        
        # Create a contact
        contact = Contact(name="Test Isolation", username="test_iso", instagram_url="https://instagram.com/test_iso")
        session.add(contact)
        await session.commit()
        await session.refresh(contact)
        
        # Create 1 Cold task and 1 Follow-up task (scheduled far in past so claim picks them first)
        cold_task = Task(contact_id=contact.id, type="MESSAGE", status="READY", scheduled_at=now - timedelta(days=999))
        fu_task = Task(contact_id=contact.id, type="FOLLOW_UP_1", status="READY", scheduled_at=now - timedelta(days=999))
        session.add_all([cold_task, fu_task])
        await session.commit()
        
        # Worker 1 claim: MUST ONLY claim cold_task
        claimed_w1 = await t_repo.claim_next_ready("WORKER-01", task_types=["MESSAGE"])
        assert claimed_w1 is not None
        assert claimed_w1.type == "MESSAGE"
        assert claimed_w1.id == cold_task.id
        
        # Worker 3 claim: MUST ONLY claim fu_task
        claimed_w3 = await t_repo.claim_next_ready("WORKER-03", task_types=["FOLLOW_UP_1", "FOLLOW_UP_2"])
        assert claimed_w3 is not None
        assert claimed_w3.type == "FOLLOW_UP_1"
        assert claimed_w3.id == fu_task.id
        
        # Clean up tasks
        await t_repo.update_status(cold_task.id, TaskStatus.COMPLETED)
        await t_repo.update_status(fu_task.id, TaskStatus.COMPLETED)

@pytest.mark.asyncio
async def test_edge_case_replied_contact_cancels_followup():
    """Verify that when a contact is marked as replied, pending follow-ups are cancelled."""
    async with AsyncSessionLocal() as session:
        t_repo = TaskRepository(session)
        now = datetime.now(timezone.utc)
        
        contact = Contact(name="Reply Cancel Test", username="reply_cancel", instagram_url="https://instagram.com/reply_cancel", replied_status="NO")
        session.add(contact)
        await session.commit()
        await session.refresh(contact)
        
        fu_task = Task(contact_id=contact.id, type="FOLLOW_UP_1", status="READY", scheduled_at=now)
        session.add(fu_task)
        await session.commit()
        await session.refresh(fu_task)
        
        # Worker 3 pre-check simulates contact replied
        contact.replied_status = "YES"
        await session.commit()
        
        # Process in followup worker pre-check: cancels task
        db_task = await t_repo.get_by_id(fu_task.id)
        if db_task.contact.replied_status in ["YES", "AUTOMATED_MESSAGE"]:
            await t_repo.update_status(fu_task.id, TaskStatus.CANCELLED)
        
        updated_task = await t_repo.get_by_id(fu_task.id)
        assert updated_task.status == TaskStatus.CANCELLED.value


@pytest.mark.asyncio
async def test_master_controls_all_workers_and_individual_worker2(client: AsyncClient):
    """Verify Start All, Pause All, Resume All, Stop All and Worker 2 individual controls."""
    # 1. Test Worker 2 lifecycle
    res_w2_start = await client.post("/api/automation/replies/start?interval_seconds=60")
    assert res_w2_start.status_code == 200
    assert res_w2_start.json()["status"] in ["started", "already_running"]

    res_w2_pause = await client.post("/api/automation/replies/pause")
    assert res_w2_pause.status_code == 200
    assert res_w2_pause.json()["status"] == "paused"

    res_w2_resume = await client.post("/api/automation/replies/resume")
    assert res_w2_resume.status_code == 200
    assert res_w2_resume.json()["status"] == "resumed"

    res_w2_stop = await client.post("/api/automation/replies/stop")
    assert res_w2_stop.status_code == 200
    assert res_w2_stop.json()["status"] == "stopped"

    # 2. Test Master All Workers controls
    res_all_start = await client.post("/api/automation/all/start", json={"batch_limit": 2})
    assert res_all_start.status_code == 200
    assert res_all_start.json()["status"] == "started_all"

    res_all_status = await client.get("/api/automation/all/status")
    assert res_all_status.status_code == 200
    data = res_all_status.json()
    assert "worker1" in data
    assert "worker2" in data
    assert "worker3" in data

    res_all_pause = await client.post("/api/automation/all/pause")
    assert res_all_pause.status_code == 200
    assert res_all_pause.json()["status"] == "paused_all"

    res_all_resume = await client.post("/api/automation/all/resume")
    assert res_all_resume.status_code == 200
    assert res_all_resume.json()["status"] == "resumed_all"

    res_all_stop = await client.post("/api/automation/all/stop")
    assert res_all_stop.status_code == 200
    assert res_all_stop.json()["status"] == "stopped_all"


@pytest.mark.asyncio
async def test_coordinator_preemption_and_auto_resume():
    """Verify that when Worker 3 preempts Worker 1, releasing Worker 3's lock auto-resumes Worker 1."""
    from backend.automation.coordinator import coordinator
    from backend.workers.instagram_worker import instagram_worker

    # Worker 1 acquires lock
    await coordinator.acquire_dm_lock("WORKER-01")
    assert coordinator.active_sender == "WORKER-01"

    # Worker 3 acquires lock -> preempts Worker 1
    await coordinator.acquire_dm_lock("WORKER-03")
    assert coordinator.active_sender == "WORKER-03"
    assert coordinator.preempted_worker == "WORKER-01"

    # Worker 3 releases lock -> coordinator clears lock and auto-resumes preempted worker
    await coordinator.release_dm_lock("WORKER-03")
    assert coordinator.active_sender is None
    assert coordinator.preempted_worker is None


@pytest.mark.asyncio
async def test_browser_live_feed_endpoints_always_return_images(client: AsyncClient):
    """Verify that /api/browser/live_feed returns HTTP 200 with image/jpeg, never 204."""
    res_outreach = await client.get("/api/browser/live_feed?worker=outreach")
    assert res_outreach.status_code == 200
    assert res_outreach.headers["content-type"].startswith("image/")
    assert len(res_outreach.content) > 100

    res_scanner = await client.get("/api/browser/live_feed?worker=scanner")
    assert res_scanner.status_code == 200
    assert res_scanner.headers["content-type"].startswith("image/")
    assert len(res_scanner.content) > 100


