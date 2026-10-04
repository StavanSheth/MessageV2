from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import json
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Source, SourceRecord

class SourceRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_source(self, type_: str, name: str, file_path_or_url: str) -> Source:
        source = Source(
            type=type_,
            name=name,
            file_path_or_url=file_path_or_url,
            status="PENDING"
        )
        self.session.add(source)
        await self.session.flush()
        return source

    async def get_by_id(self, source_id: str) -> Optional[Source]:
        stmt = select(Source).where(Source.id == source_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_sources(self, limit: int = 50) -> List[Source]:
        stmt = select(Source).order_by(Source.created_at.desc()).limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update_counts(self, source_id: str, total: int, valid: int, invalid: int, imported: int, status: str = "ACCESSIBLE"):
        stmt = update(Source).where(Source.id == source_id).values(
            total_rows=total,
            valid_rows=valid,
            invalid_rows=invalid,
            imported_rows=imported,
            status=status,
            last_sync_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        await self.session.execute(stmt)
        await self.session.commit()

    async def create_record(self, source_id: str, raw_data: Dict[str, Any],
                            normalized_data: Optional[Dict[str, Any]] = None,
                            status: str = "VALID", error_message: Optional[str] = None) -> SourceRecord:
        record = SourceRecord(
            source_id=source_id,
            raw_data=json.dumps(raw_data),
            normalized_data=json.dumps(normalized_data) if normalized_data else None,
            status=status,
            error_message=error_message
        )
        self.session.add(record)
        await self.session.flush()
        return record
