import pytest
from unittest.mock import AsyncMock, MagicMock
from backend.domain.enums import ResultCode, TaskStatus, WorkerStatus
from backend.automation.instagram.result_detector import ResultDetector
from backend.workers.instagram_worker import InstagramWorker

def test_result_detector_rate_limiting():
    code = ResultDetector.classify_navigation_result(200, "Please try again later. We limit how often you can do this.")
    assert code == ResultCode.RATE_LIMITED

    code2 = ResultDetector.classify_navigation_result(200, "Sorry, this page isn't available. The link you followed may be broken.")
    assert code2 == ResultCode.PROFILE_NOT_FOUND

@pytest.mark.asyncio
async def test_worker_batch_initialization():
    worker = InstagramWorker()
    assert worker.batch_limit is None
    assert worker.batch_sent_count == 0

    # Start with batch limit 5 and delay 20s
    await worker.start(batch_limit=5, delay_seconds=20)
    assert worker.batch_limit == 5
    assert worker.delay_between_messages == 20
    assert worker.batch_sent_count == 0

    h = await worker.health()
    assert h["batch_limit"] == 5
    assert h["batch_sent_count"] == 0
    assert h["delay_seconds"] == 20

    await worker.stop()
