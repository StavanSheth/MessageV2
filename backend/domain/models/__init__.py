from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from backend.domain.enums import (
    TaskType,
    TaskStatus,
    MessageStatus,
    VerificationDecision,
    ResultCode,
    WorkerStatus,
    AutomationStage,
    RepliedStatus,
    SourceType,
    SourceStatus,
    EventCode,
    Severity,
    NetworkStatus
)

# Contacts
class ContactBase(BaseModel):
    name: str
    instagram_url: str
    username: Optional[str] = None
    expected_followers: Optional[int] = None
    message: str = "Hey"
    followup_1_message: Optional[str] = None
    followup_1_delay_days: int = 3
    followup_2_message: Optional[str] = None
    followup_2_delay_days: int = 5
    replied_status: RepliedStatus = RepliedStatus.UNKNOWN
    auto_reply_message: Optional[str] = None
    extracted_phone: Optional[str] = None
    extracted_email: Optional[str] = None
    extracted_link: Optional[str] = None
    last_checked_reply_at: Optional[datetime] = None
    reply_detected_at: Optional[datetime] = None
    notes: Optional[str] = None

class ContactCreate(ContactBase):
    source_record_id: Optional[str] = None

class ContactUpdate(BaseModel):
    name: Optional[str] = None
    instagram_url: Optional[str] = None
    username: Optional[str] = None
    expected_followers: Optional[int] = None
    message: Optional[str] = None
    replied_status: Optional[RepliedStatus] = None
    auto_reply_message: Optional[str] = None
    extracted_phone: Optional[str] = None
    extracted_email: Optional[str] = None
    extracted_link: Optional[str] = None
    last_checked_reply_at: Optional[datetime] = None
    reply_detected_at: Optional[datetime] = None
    notes: Optional[str] = None

class ContactRead(ContactBase):
    id: str
    source_record_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# Tasks
class TaskBase(BaseModel):
    contact_id: str
    type: TaskType = TaskType.MESSAGE
    status: TaskStatus = TaskStatus.CREATED
    sequence: int = 1
    priority: int = 1
    scheduled_at: Optional[datetime] = None

class TaskCreate(TaskBase):
    pass

class TaskRead(TaskBase):
    id: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    attempt_count: int = 0
    worker_id: Optional[str] = None
    last_error_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    contact: Optional[ContactRead] = None

    class Config:
        from_attributes = True

# Messages
class MessageBase(BaseModel):
    contact_id: str
    task_id: str
    sequence: int = 1
    body: str
    status: MessageStatus = MessageStatus.PENDING

class MessageRead(MessageBase):
    id: str
    attempted_at: Optional[datetime] = None
    confirmed_at: Optional[datetime] = None
    result_code: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

# Sources
class SourceCreateURL(BaseModel):
    url: str
    name: Optional[str] = None

class SourceRead(BaseModel):
    id: str
    type: SourceType
    name: str
    file_path_or_url: str
    total_rows: int
    valid_rows: int
    invalid_rows: int
    imported_rows: int
    status: SourceStatus
    last_sync_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# Events
class EventCreate(BaseModel):
    level: str = "INFO"
    category: str = "AUTOMATION"
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    event_code: EventCode
    payload: Optional[Dict[str, Any]] = None
    correlation_id: Optional[str] = None

class EventRead(BaseModel):
    id: str
    timestamp: datetime
    level: str
    category: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    event_code: str
    payload_json: Optional[str] = None
    correlation_id: Optional[str] = None

    class Config:
        from_attributes = True

# Worker & Live Automation
class WorkerRead(BaseModel):
    id: str
    name: str
    status: WorkerStatus
    browser_status: str
    instagram_login_status: str
    current_task_id: Optional[str] = None
    current_contact_id: Optional[str] = None
    current_stage: AutomationStage
    current_url: Optional[str] = None
    last_heartbeat_at: datetime

    class Config:
        from_attributes = True

class LiveAutomationState(BaseModel):
    worker_id: str = "WORKER-01"
    worker_name: str = "Instagram Worker 01"
    status: WorkerStatus = WorkerStatus.IDLE
    browser_status: str = "DISCONNECTED"
    instagram_login_status: str = "UNKNOWN"
    current_contact_name: Optional[str] = None
    current_instagram: Optional[str] = None
    current_task_id: Optional[str] = None
    current_stage: AutomationStage = AutomationStage.IDLE
    verification_confidence: Optional[float] = None
    verification_decision: Optional[VerificationDecision] = None
    elapsed_seconds: int = 0
    last_event: Optional[str] = None
    last_screenshot_url: Optional[str] = None
    last_error: Optional[str] = None
    requires_attention: bool = False
    attention_reason: Optional[str] = None

# Overview Stats
class OverviewStats(BaseModel):
    total_contacts: int = 0
    pending_tasks: int = 0
    ready_tasks: int = 0
    running_tasks: int = 0
    completed_tasks: int = 0
    failed_tasks: int = 0
    skipped_tasks: int = 0
    manual_review_tasks: int = 0
    browser_status: str = "DISCONNECTED"
    instagram_login_status: str = "UNKNOWN"
    current_worker: str = "Instagram Worker 01"
    current_contact: Optional[str] = None
    current_stage: AutomationStage = AutomationStage.IDLE
    last_event: Optional[str] = None

# Verification Output
class VerificationSignal(BaseModel):
    name: str
    expected: Any
    extracted: Any
    score: float
    weight: float
    notes: Optional[str] = None

class VerificationOutput(BaseModel):
    confidence: float
    signals: List[VerificationSignal]
    decision: VerificationDecision
    reason: str
