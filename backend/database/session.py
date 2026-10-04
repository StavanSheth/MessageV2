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

def _auto_migrate(connection):
    """Safely add missing columns to existing SQLite tables based on Base.metadata."""
    from sqlalchemy import text
    for table_name, table in Base.metadata.tables.items():
        try:
            res = connection.execute(text(f"PRAGMA table_info({table_name});")).fetchall()
            existing_cols = {r[1] for r in res}
            if existing_cols:
                for col in table.columns:
                    if col.name not in existing_cols:
                        col_type = str(col.type)
                        default_clause = ""
                        if col.default is not None and hasattr(col.default, "arg") and not callable(col.default.arg):
                            default_clause = f" DEFAULT '{col.default.arg}'" if isinstance(col.default.arg, str) else f" DEFAULT {col.default.arg}"
                        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}{default_clause};"))
        except Exception:
            pass

async def init_db():
    """Create all tables in the SQLite database asynchronously and migrate columns."""
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_auto_migrate)

def init_db_sync():
    """Create all tables in the SQLite database synchronously and migrate columns."""
    Base.metadata.create_all(bind=sync_engine)
    with sync_engine.begin() as conn:
        _auto_migrate(conn)

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
