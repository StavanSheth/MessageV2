from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Contact, SourceRecord

class ContactRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, name: str, instagram_url: str, username: Optional[str] = None,
                     message: str = "Hey", expected_followers: Optional[int] = None,
                     source_record_id: Optional[str] = None, notes: Optional[str] = None) -> Contact:
        contact = Contact(
            name=name,
            instagram_url=instagram_url,
            username=username,
            message=message,
            expected_followers=expected_followers,
            source_record_id=source_record_id,
            notes=notes
        )
        self.session.add(contact)
        await self.session.flush()
        return contact

    async def get_by_id(self, contact_id: str) -> Optional[Contact]:
        stmt = select(Contact).where(Contact.id == contact_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by_instagram(self, instagram_url: str, username: Optional[str] = None) -> Optional[Contact]:
        conditions = [Contact.instagram_url == instagram_url]
        if username:
            conditions.append(Contact.username == username)
        stmt = select(Contact).where(*conditions)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(self, limit: int = 100, offset: int = 0) -> List[Contact]:
        stmt = select(Contact).order_by(Contact.created_at.desc()).limit(limit).offset(offset)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count(self) -> int:
        from sqlalchemy import func
        stmt = select(func.count(Contact.id))
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def update_replied(self, contact_id: str, status: str) -> Optional[Contact]:
        stmt = update(Contact).where(Contact.id == contact_id).values(
            replied_status=status,
            updated_at=datetime.now(timezone.utc)
        ).returning(Contact)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()
