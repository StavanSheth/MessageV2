import pytest
from backend.automation.coordinator import DMCoordinator
from backend.domain.enums import TaskStatus

@pytest.mark.asyncio
async def test_coordinator_mutual_exclusion():
    coord = DMCoordinator()
    
    # Worker 1 acquires lock
    res1 = await coord.acquire_dm_lock("WORKER-01")
    assert res1 is True
    assert coord.active_sender == "WORKER-01"
    
    status = coord.get_status()
    assert status["active_sender"] == "WORKER-01"
    assert status["lock_held"] is True
    
    # Worker 3 acquires lock -> preempts Worker 1
    res3 = await coord.acquire_dm_lock("WORKER-03")
    assert res3 is True
    assert coord.active_sender == "WORKER-03"
    
    # Worker 3 releases lock
    await coord.release_dm_lock("WORKER-03")
    assert coord.active_sender is None
    assert coord.get_status()["lock_held"] is False

@pytest.mark.asyncio
async def test_coordinator_mode_setting():
    coord = DMCoordinator()
    assert coord.mode == "BALANCED"
    coord.mode = "FOLLOWUP_ONLY"
    assert coord.get_status()["mode"] == "FOLLOWUP_ONLY"
