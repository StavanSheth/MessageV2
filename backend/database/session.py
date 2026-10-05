import os
from contextlib import asynccontextmanager, contextmanager
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend.config.settings import settings
from backend.database.models import Base

# Async Engine for FastAPI and async services
async_engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False}
)

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

# Sync Engine for synchronous tasks / CLI utilities
sync_engine = create_engine(
    settings.SYNC_DATABASE_URL,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False}
)

SyncSessionLocal = sessionmaker(
    bind=sync_engine,
    class_=Session,
    expire_on_commit=False,
    autoflush=False
)

from sqlalchemy import event

def _set_sqlite_pragmas(dbapi_connection, connection_record):
    """Enforce foreign keys, WAL mode for high concurrency, and 10s busy timeout."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA busy_timeout = 10000")
    cursor.execute("PRAGMA synchronous = NORMAL")
    cursor.close()

event.listen(sync_engine, "connect", _set_sqlite_pragmas)
event.listen(async_engine.sync_engine, "connect", _set_sqlite_pragmas)

async def init_db():
    """Create all tables in the SQLite database asynchronously and ensure schema updates."""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        def _check_columns(sync_conn):
            from sqlalchemy import inspect, text
            inspector = inspect(sync_conn)
            if "contacts" in inspector.get_table_names():
                cols = [c["name"] for c in inspector.get_columns("contacts")]
                if "is_archived" not in cols:
                    sync_conn.execute(text("ALTER TABLE contacts ADD COLUMN is_archived BOOLEAN DEFAULT 0"))
                if "last_run_id" not in cols:
                    sync_conn.execute(text("ALTER TABLE contacts ADD COLUMN last_run_id TEXT"))
            if "tasks" in inspector.get_table_names():
                cols = [c["name"] for c in inspector.get_columns("tasks")]
                if "run_id" not in cols:
                    sync_conn.execute(text("ALTER TABLE tasks ADD COLUMN run_id TEXT"))
            if "outreach_history" in inspector.get_table_names():
                cols = [c["name"] for c in inspector.get_columns("outreach_history")]
                if "run_id" not in cols:
                    sync_conn.execute(text("ALTER TABLE outreach_history ADD COLUMN run_id TEXT"))
        await conn.run_sync(_check_columns)

def init_db_sync():
    """Create all tables in the SQLite database synchronously and ensure schema updates."""
    Base.metadata.create_all(bind=sync_engine)
    from sqlalchemy import inspect, text
    with sync_engine.begin() as conn:
        inspector = inspect(conn)
        if "contacts" in inspector.get_table_names():
            cols = [c["name"] for c in inspector.get_columns("contacts")]
            if "is_archived" not in cols:
                conn.execute(text("ALTER TABLE contacts ADD COLUMN is_archived BOOLEAN DEFAULT 0"))
            if "last_run_id" not in cols:
                conn.execute(text("ALTER TABLE contacts ADD COLUMN last_run_id TEXT"))
        if "tasks" in inspector.get_table_names():
            cols = [c["name"] for c in inspector.get_columns("tasks")]
            if "run_id" not in cols:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN run_id TEXT"))
        if "outreach_history" in inspector.get_table_names():
            cols = [c["name"] for c in inspector.get_columns("outreach_history")]
            if "run_id" not in cols:
                conn.execute(text("ALTER TABLE outreach_history ADD COLUMN run_id TEXT"))

@asynccontextmanager
async def get_async_db():
    """Async session context manager."""
    session = AsyncSessionLocal()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()

async def get_db():
    """Dependency for FastAPI endpoints."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
