"""Database schema migrations and index maintenance.

Provides idempotent schema verification and index creation for SQLite.
"""
from sqlalchemy import inspect, text

def run_migrations(sync_conn):
    """Ensure missing columns and performance indexes exist on the SQLite database."""
    inspector = inspect(sync_conn)
    tables = set(inspector.get_table_names())

    # --- Column Migrations ---
    if "contacts" in tables:
        cols = {c["name"] for c in inspector.get_columns("contacts")}
        if "is_archived" not in cols:
            sync_conn.execute(text("ALTER TABLE contacts ADD COLUMN is_archived BOOLEAN DEFAULT 0"))
        if "last_run_id" not in cols:
            sync_conn.execute(text("ALTER TABLE contacts ADD COLUMN last_run_id TEXT"))

    if "tasks" in tables:
        cols = {c["name"] for c in inspector.get_columns("tasks")}
        if "run_id" not in cols:
            sync_conn.execute(text("ALTER TABLE tasks ADD COLUMN run_id TEXT"))

    if "outreach_history" in tables:
        cols = {c["name"] for c in inspector.get_columns("outreach_history")}
        if "run_id" not in cols:
            sync_conn.execute(text("ALTER TABLE outreach_history ADD COLUMN run_id TEXT"))

    # --- Performance Indexes ---
    indexes_to_create = [
        ("contacts", "ix_contacts_name", "CREATE INDEX IF NOT EXISTS ix_contacts_name ON contacts (name)"),
        ("contacts", "ix_contacts_created_at", "CREATE INDEX IF NOT EXISTS ix_contacts_created_at ON contacts (created_at)"),
        ("contacts", "ix_contacts_archived_replied", "CREATE INDEX IF NOT EXISTS ix_contacts_archived_replied ON contacts (is_archived, replied_status)"),
        ("tasks", "ix_tasks_type", "CREATE INDEX IF NOT EXISTS ix_tasks_type ON tasks (type)"),
        ("tasks", "ix_tasks_scheduled_at", "CREATE INDEX IF NOT EXISTS ix_tasks_scheduled_at ON tasks (scheduled_at)"),
        ("tasks", "ix_tasks_completed_at", "CREATE INDEX IF NOT EXISTS ix_tasks_completed_at ON tasks (completed_at)"),
        ("tasks", "ix_tasks_contact_type", "CREATE INDEX IF NOT EXISTS ix_tasks_contact_type ON tasks (contact_id, type)"),
        ("tasks", "ix_tasks_contact_status", "CREATE INDEX IF NOT EXISTS ix_tasks_contact_status ON tasks (contact_id, status)"),
        ("source_records", "ix_source_records_source_id", "CREATE INDEX IF NOT EXISTS ix_source_records_source_id ON source_records (source_id)"),
        ("errors", "ix_errors_task_id", "CREATE INDEX IF NOT EXISTS ix_errors_task_id ON errors (task_id)"),
        ("sync_runs", "ix_sync_runs_source_id", "CREATE INDEX IF NOT EXISTS ix_sync_runs_source_id ON sync_runs (source_id)"),
        ("automation_runs", "ix_automation_runs_task_id", "CREATE INDEX IF NOT EXISTS ix_automation_runs_task_id ON automation_runs (task_id)"),
        ("browser_sessions", "ix_browser_sessions_worker_id", "CREATE INDEX IF NOT EXISTS ix_browser_sessions_worker_id ON browser_sessions (worker_id)"),
    ]

    for table_name, _, create_sql in indexes_to_create:
        if table_name in tables:
            try:
                sync_conn.execute(text(create_sql))
            except Exception:
                pass
