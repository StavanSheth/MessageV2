import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.network.network_monitor import NetworkMonitor, NetworkState
from backend.domain.enums import ResultCode, TaskStatus
from backend.recovery.recovery_service import RecoveryService
from backend.repositories.task_repository import TaskRepository
from backend.repositories.contact_repository import ContactRepository
from backend.database.models import Message

@pytest.mark.asyncio
async def test_network_state_and_offline_detection():
    monitor = NetworkMonitor(check_host="192.0.2.1", check_port=80, timeout=0.1) # RFC 5737 non-routable IP
    is_on = monitor.is_online()
    assert is_on is False
    assert monitor.state in {NetworkState.FLAPPING, NetworkState.OFFLINE}

@pytest.mark.asyncio
async def test_network_failure_during_send_classified_as_send_unknown():
    """
    CRITICAL INVARIANT:
    During send, NEVER classify a lost connection as NOT_SENT.
    Ambiguous outcome MUST be classified as SEND_UNKNOWN so it enters reconciliation.
    """
    monitor = NetworkMonitor()
    result = monitor.classify_send_failure(network_dropped_during_send=True)
    assert result == ResultCode.SEND_UNKNOWN

    # If network dropped before send action started, it can safely be classified as NETWORK_ERROR
    result_before = monitor.classify_send_failure(network_dropped_during_send=False)
    assert result_before == ResultCode.NETWORK_ERROR

@pytest.mark.asyncio
async def test_browser_crash_during_send_reconciliation(test_session: AsyncSession):
    """
    When browser crashes while a task is SENDING and has a Message record,
    RecoveryService MUST move task to RECONCILING, never blindly reset to READY!
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Crash User",
        instagram_url="https://instagram.com/crashuser/",
        username="crashuser"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await task_repo.update_status(task.id, TaskStatus.RUNNING)
    await task_repo.update_status(task.id, TaskStatus.SENDING)

    msg = Message(contact_id=contact.id, task_id=task.id, body="Hi", status="PENDING")
    test_session.add(msg)
    await test_session.commit()

    # Browser crashes
    recovery = RecoveryService(test_session)
    await recovery.handle_browser_crash(task.id)

    # Verify task state
    refreshed_task = await task_repo.get_by_id(task.id)
    assert refreshed_task.status == TaskStatus.RECONCILING.value
    assert "Browser crashed during or immediately following message send" in refreshed_task.manual_review_reason

@pytest.mark.asyncio
async def test_browser_crash_before_send_safely_resets_to_ready(test_session: AsyncSession):
    """
    When browser crashes before any message was attempted (no Message record),
    it is safe to reset task to READY so it can be picked up cleanly.
    """
    task_repo = TaskRepository(test_session)
    contact_repo = ContactRepository(test_session)

    contact = await contact_repo.create(
        name="Pre-Send Crash User",
        instagram_url="https://instagram.com/presenduser/",
        username="presenduser"
    )
    task = await task_repo.create(contact_id=contact.id, task_type="MESSAGE")
    await task_repo.update_status(task.id, TaskStatus.RUNNING)
    await task_repo.update_status(task.id, TaskStatus.VERIFYING)

    # No Message record exists
    recovery = RecoveryService(test_session)
    await recovery.handle_browser_crash(task.id)

    refreshed_task = await task_repo.get_by_id(task.id)
    assert refreshed_task.status == TaskStatus.READY.value
    assert refreshed_task.lease_owner is None
