from datetime import datetime, timezone
import uuid
import json
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    Boolean,
    DateTime,
    Text,
    ForeignKey,
    UniqueConstraint,
    Index
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

def utcnow():
    return datetime.now(timezone.utc)

def generate_id(prefix=""):
    short_uuid = str(uuid.uuid4())[:8]
    return f"{prefix}{short_uuid}" if prefix else str(uuid.uuid4())

class Source(Base):
    __tablename__ = "sources"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("src_"))
    type = Column(String(32), nullable=False)  # XLSX, BROWSER_SHEET
    name = Column(String(255), nullable=False)
    file_path_or_url = Column(Text, nullable=False)
    total_rows = Column(Integer, default=0)
    valid_rows = Column(Integer, default=0)
    invalid_rows = Column(Integer, default=0)
    imported_rows = Column(Integer, default=0)
    status = Column(String(32), default="PENDING")
    last_sync_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    records = relationship("SourceRecord", back_populates="source", cascade="all, delete-orphan")

class SourceRecord(Base):
    __tablename__ = "source_records"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("rec_"))
    source_id = Column(String(64), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    raw_data = Column(Text, nullable=False)  # JSON string
    normalized_data = Column(Text, nullable=True)  # JSON string
    status = Column(String(32), default="VALID")
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    source = relationship("Source", back_populates="records")
    contact = relationship("Contact", back_populates="source_record", uselist=False)

class Contact(Base):
    __tablename__ = "contacts"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("cnt_"))
    source_record_id = Column(String(64), ForeignKey("source_records.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    instagram_url = Column(String(512), nullable=False, index=True)
    username = Column(String(255), nullable=True, index=True)
    expected_followers = Column(Integer, nullable=True)
    message = Column(Text, nullable=False, default="Hey")
    followup_1_message = Column(Text, nullable=True)
    followup_1_delay_days = Column(Integer, default=3)
    followup_2_message = Column(Text, nullable=True)
    followup_2_delay_days = Column(Integer, default=5)
    replied_status = Column(String(32), default="UNKNOWN")  # UNKNOWN, YES, NO, AUTOMATED_MESSAGE, DM_RESTRICTED
    auto_reply_message = Column(Text, nullable=True)
    extracted_phone = Column(String(128), nullable=True)
    extracted_email = Column(String(255), nullable=True)
    extracted_link = Column(String(512), nullable=True)
    last_checked_reply_at = Column(DateTime, nullable=True)
    reply_detected_at = Column(DateTime, nullable=True)
    replied_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    is_archived = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    source_record = relationship("SourceRecord", back_populates="contact")
    tasks = relationship("Task", back_populates="contact", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="contact", cascade="all, delete-orphan")

class Task(Base):
    __tablename__ = "tasks"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("tsk_"))
    contact_id = Column(String(64), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(32), nullable=False, default="MESSAGE")  # MESSAGE, FOLLOW_UP_1, FOLLOW_UP_2
    status = Column(String(32), nullable=False, default="CREATED", index=True)
    sequence = Column(Integer, default=1)
    priority = Column(Integer, default=1)
    scheduled_at = Column(DateTime, default=utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    attempt_count = Column(Integer, default=0)
    worker_id = Column(String(64), nullable=True)
    lease_owner = Column(String(64), nullable=True)
    lease_expires_at = Column(DateTime, nullable=True)
    send_attempt_id = Column(String(64), nullable=True)
    send_requested_at = Column(DateTime, nullable=True)
    reconciliation_status = Column(String(64), nullable=True)
    idempotency_key = Column(String(128), unique=True, nullable=True)
    manual_review_reason = Column(Text, nullable=True)
    source_sync_status = Column(String(32), nullable=True)
    source_sync_error = Column(Text, nullable=True)
    last_error_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("contact_id", "type", "sequence", name="uq_contact_task_seq"),
    )

    contact = relationship("Contact", back_populates="tasks")
    messages = relationship("Message", back_populates="task")
    errors = relationship("Error", back_populates="task")
    verifications = relationship("VerificationResult", back_populates="task")
    send_attempts = relationship("SendAttempt", back_populates="task", cascade="all, delete-orphan")

class Message(Base):
    __tablename__ = "messages"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("msg_"))
    contact_id = Column(String(64), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    task_id = Column(String(64), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    sequence = Column(Integer, default=1)
    body = Column(Text, nullable=False)
    status = Column(String(32), default="PENDING")
    attempted_at = Column(DateTime, nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    result_code = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=utcnow)

    contact = relationship("Contact", back_populates="messages")
    task = relationship("Task", back_populates="messages")
    send_attempts = relationship("SendAttempt", back_populates="message", cascade="all, delete-orphan")

class SendAttempt(Base):
    __tablename__ = "send_attempts"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("att_"))
    task_id = Column(String(64), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id = Column(String(64), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True)
    attempt_id = Column(String(64), nullable=False, index=True)
    contact_id = Column(String(64), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False, index=True)
    message_body = Column(Text, nullable=False)
    send_requested_at = Column(DateTime, default=utcnow, nullable=False)
    send_confirmed_at = Column(DateTime, nullable=True)
    worker_id = Column(String(64), nullable=False)
    browser_session_id = Column(String(64), nullable=True)
    status = Column(String(32), default="REQUESTED")  # REQUESTED, CONFIRMED, FAILED, UNKNOWN
    result_code = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=utcnow)

    task = relationship("Task", back_populates="send_attempts")
    message = relationship("Message", back_populates="send_attempts")

class Worker(Base):
    __tablename__ = "workers"

    id = Column(String(64), primary_key=True)
    name = Column(String(128), nullable=False)
    status = Column(String(32), default="IDLE")  # IDLE, RUNNING, PAUSED, STOPPED, ERROR
    browser_status = Column(String(32), default="DISCONNECTED")  # CONNECTED, DISCONNECTED, ERROR
    instagram_login_status = Column(String(32), default="UNKNOWN")  # LOGGED_IN, LOGIN_REQUIRED, UNKNOWN
    current_task_id = Column(String(64), nullable=True)
    current_contact_id = Column(String(64), nullable=True)
    current_stage = Column(String(64), default="IDLE")
    current_url = Column(String(512), nullable=True)
    last_heartbeat_at = Column(DateTime, default=utcnow)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

class BrowserSession(Base):
    __tablename__ = "browser_sessions"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("ses_"))
    worker_id = Column(String(64), nullable=False)
    browser_type = Column(String(32), default="chromium")
    user_data_dir = Column(Text, nullable=False)
    is_headless = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    last_seen_url = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

class VerificationResult(Base):
    __tablename__ = "verification_results"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("vrf_"))
    task_id = Column(String(64), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    contact_id = Column(String(64), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    confidence = Column(Float, nullable=False)
    decision = Column(String(32), nullable=False)
    signals_json = Column(Text, nullable=False)  # JSON
    screenshot_path = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    task = relationship("Task", back_populates="verifications")

class Event(Base):
    __tablename__ = "events"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("evt_"))
    timestamp = Column(DateTime, default=utcnow, index=True)
    level = Column(String(16), default="INFO")
    category = Column(String(32), default="AUTOMATION")
    entity_type = Column(String(32), nullable=True)
    entity_id = Column(String(64), nullable=True)
    event_code = Column(String(64), nullable=False, index=True)
    payload_json = Column(Text, nullable=True)
    correlation_id = Column(String(64), nullable=True)

class Error(Base):
    __tablename__ = "errors"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("err_"))
    task_id = Column(String(64), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    worker_id = Column(String(64), nullable=True)
    code = Column(String(64), nullable=False)
    message = Column(Text, nullable=False)
    severity = Column(String(32), default="ERROR")
    retryable = Column(Boolean, default=True)
    attempt = Column(Integer, default=1)
    created_at = Column(DateTime, default=utcnow)
    resolved_at = Column(DateTime, nullable=True)

    task = relationship("Task", back_populates="errors")

class AutomationRun(Base):
    __tablename__ = "automation_runs"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("run_"))
    worker_id = Column(String(64), nullable=False)
    task_id = Column(String(64), nullable=False)
    start_time = Column(DateTime, default=utcnow)
    end_time = Column(DateTime, nullable=True)
    status = Column(String(32), default="RUNNING")
    result_code = Column(String(64), nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

class SyncRun(Base):
    __tablename__ = "sync_runs"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("sync_"))
    source_id = Column(String(64), ForeignKey("sources.id", ondelete="CASCADE"), nullable=False)
    started_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String(32), default="PENDING")
    rows_processed = Column(Integer, default=0)
    errors_count = Column(Integer, default=0)

class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(128), primary_key=True)
    value = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

class OutreachHistory(Base):
    __tablename__ = "outreach_history"

    id = Column(String(64), primary_key=True, default=lambda: generate_id("oh_"))
    username = Column(String(255), nullable=True, index=True)
    instagram_url = Column(String(512), nullable=False, index=True)
    contact_name = Column(String(255), nullable=True)
    action = Column(String(64), nullable=False)  # MESSAGED, REPLIED, FOLLOW_UP_1, FOLLOW_UP_2, ARCHIVED
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow)

