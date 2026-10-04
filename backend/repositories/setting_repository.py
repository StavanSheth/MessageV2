from typing import Optional, List, Dict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import Setting

class SettingRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_value(self, key: str, default: Optional[str] = None) -> Optional[str]:
        stmt = select(Setting).where(Setting.key == key)
        result = await self.session.execute(stmt)
        setting = result.scalar_one_or_none()
        if setting:
            return setting.value
        return default

    async def set_value(self, key: str, value: str, description: Optional[str] = None) -> Setting:
        stmt = select(Setting).where(Setting.key == key)
        result = await self.session.execute(stmt)
        setting = result.scalar_one_or_none()
        if setting:
            setting.value = value
            if description:
                setting.description = description
        else:
            setting = Setting(key=key, value=value, description=description)
            self.session.add(setting)
        await self.session.commit()
        await self.session.refresh(setting)
        return setting

    async def list_all(self) -> Dict[str, str]:
        stmt = select(Setting)
        result = await self.session.execute(stmt)
        settings = result.scalars().all()
        return {s.key: s.value for s in settings}
