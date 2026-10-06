from typing import Set, Dict
from backend.domain.enums import TaskStatus, MessageStatus

class StateTransitionError(Exception):
    def __init__(self, from_state: str, to_state: str, entity_name: str = "Task"):
        super().__init__(f"Invalid {entity_name} state transition from '{from_state}' to '{to_state}'")
        self.from_state = from_state
        self.to_state = to_state

VALID_TASK_TRANSITIONS: Dict[TaskStatus, Set[TaskStatus]] = {
    TaskStatus.CREATED: {TaskStatus.VALIDATING, TaskStatus.QUEUED, TaskStatus.READY, TaskStatus.CANCELLED, TaskStatus.PAUSED},
    TaskStatus.VALIDATING: {TaskStatus.QUEUED, TaskStatus.READY, TaskStatus.SKIPPED, TaskStatus.CANCELLED, TaskStatus.PAUSED},
    TaskStatus.QUEUED: {TaskStatus.READY, TaskStatus.CANCELLED, TaskStatus.PAUSED},
    TaskStatus.READY: {TaskStatus.RUNNING, TaskStatus.CANCELLED, TaskStatus.PAUSED},
    TaskStatus.PAUSED: {TaskStatus.READY, TaskStatus.CANCELLED, TaskStatus.SKIPPED},
    TaskStatus.RUNNING: {
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.READY,
        TaskStatus.RETRY_WAIT,
        TaskStatus.MANUAL_REVIEW,
        TaskStatus.AWAITING_APPROVAL,
        TaskStatus.SKIPPED,
        TaskStatus.CANCELLED,
        TaskStatus.INTERRUPTED,
        TaskStatus.RECONCILING,
        TaskStatus.PAUSED,
        TaskStatus.SENDING,
        TaskStatus.VERIFYING
    },
    TaskStatus.SENDING: {
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.READY,
        TaskStatus.RETRY_WAIT,
        TaskStatus.MANUAL_REVIEW,
        TaskStatus.SKIPPED,
        TaskStatus.CANCELLED,
        TaskStatus.RECONCILING
    },
    TaskStatus.VERIFYING: {
        TaskStatus.SENDING,
        TaskStatus.READY,
        TaskStatus.MANUAL_REVIEW,
        TaskStatus.SKIPPED,
        TaskStatus.CANCELLED
    },
    TaskStatus.FAILED: {TaskStatus.READY, TaskStatus.RETRY_WAIT, TaskStatus.CANCELLED, TaskStatus.MANUAL_REVIEW},
    TaskStatus.AWAITING_APPROVAL: {TaskStatus.READY, TaskStatus.APPROVED, TaskStatus.SKIPPED, TaskStatus.CANCELLED, TaskStatus.MANUAL_REVIEW, TaskStatus.COMPLETED, TaskStatus.PAUSED},
    TaskStatus.APPROVED: {TaskStatus.READY, TaskStatus.RUNNING, TaskStatus.CANCELLED, TaskStatus.SKIPPED},
    TaskStatus.RETRY_WAIT: {TaskStatus.READY, TaskStatus.CANCELLED, TaskStatus.PAUSED},
    TaskStatus.MANUAL_REVIEW: {TaskStatus.READY, TaskStatus.SKIPPED, TaskStatus.CANCELLED, TaskStatus.COMPLETED, TaskStatus.PAUSED},
    TaskStatus.RECONCILING: {TaskStatus.COMPLETED, TaskStatus.READY, TaskStatus.MANUAL_REVIEW, TaskStatus.CANCELLED},
    TaskStatus.INTERRUPTED: {TaskStatus.RECONCILING, TaskStatus.READY, TaskStatus.MANUAL_REVIEW, TaskStatus.CANCELLED},
    TaskStatus.COMPLETED: set(),
    TaskStatus.SKIPPED: set(),
    TaskStatus.CANCELLED: set(),
}


VALID_MESSAGE_TRANSITIONS: Dict[MessageStatus, Set[MessageStatus]] = {
    MessageStatus.PENDING: {MessageStatus.VERIFYING, MessageStatus.SKIPPED},
    MessageStatus.VERIFYING: {MessageStatus.VERIFIED, MessageStatus.SKIPPED, MessageStatus.FAILED},
    MessageStatus.VERIFIED: {MessageStatus.AWAITING_APPROVAL, MessageStatus.APPROVED, MessageStatus.SENDING, MessageStatus.SKIPPED},
    MessageStatus.AWAITING_APPROVAL: {MessageStatus.APPROVED, MessageStatus.SKIPPED, MessageStatus.FAILED},
    MessageStatus.APPROVED: {MessageStatus.SENDING, MessageStatus.SKIPPED},
    MessageStatus.SENDING: {MessageStatus.SENT, MessageStatus.FAILED, MessageStatus.SKIPPED, MessageStatus.UNKNOWN},
    MessageStatus.UNKNOWN: {MessageStatus.SENT, MessageStatus.FAILED, MessageStatus.AWAITING_APPROVAL, MessageStatus.SKIPPED},
    MessageStatus.SENT: set(),
    MessageStatus.FAILED: {MessageStatus.PENDING},  # allowed for retry
    MessageStatus.SKIPPED: set(),
}

def validate_task_transition(current: TaskStatus, target: TaskStatus) -> bool:
    if current == target:
        return True
    allowed = VALID_TASK_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise StateTransitionError(current.value, target.value, "Task")
    return True

def validate_message_transition(current: MessageStatus, target: MessageStatus) -> bool:
    if current == target:
        return True
    allowed = VALID_MESSAGE_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise StateTransitionError(current.value, target.value, "Message")
    return True
