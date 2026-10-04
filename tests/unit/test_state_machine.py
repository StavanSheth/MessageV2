import pytest
from backend.domain.enums import TaskStatus, MessageStatus
from backend.domain.state_machine.task_machine import (
    validate_task_transition,
    validate_message_transition,
    StateTransitionError
)

def test_valid_task_transitions():
    assert validate_task_transition(TaskStatus.CREATED, TaskStatus.QUEUED)
    assert validate_task_transition(TaskStatus.QUEUED, TaskStatus.READY)
    assert validate_task_transition(TaskStatus.READY, TaskStatus.RUNNING)
    assert validate_task_transition(TaskStatus.RUNNING, TaskStatus.COMPLETED)
    assert validate_task_transition(TaskStatus.RUNNING, TaskStatus.RETRY_WAIT)
    assert validate_task_transition(TaskStatus.RETRY_WAIT, TaskStatus.READY)

def test_invalid_task_transitions():
    with pytest.raises(StateTransitionError):
        validate_task_transition(TaskStatus.CREATED, TaskStatus.COMPLETED)

    with pytest.raises(StateTransitionError):
        validate_task_transition(TaskStatus.COMPLETED, TaskStatus.RUNNING)

def test_valid_message_transitions():
    assert validate_message_transition(MessageStatus.PENDING, MessageStatus.VERIFYING)
    assert validate_message_transition(MessageStatus.VERIFYING, MessageStatus.VERIFIED)
    assert validate_message_transition(MessageStatus.VERIFIED, MessageStatus.SENDING)
    assert validate_message_transition(MessageStatus.SENDING, MessageStatus.SENT)

def test_invalid_message_transitions():
    with pytest.raises(StateTransitionError):
        validate_message_transition(MessageStatus.PENDING, MessageStatus.SENT)
