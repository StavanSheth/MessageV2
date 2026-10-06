from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.models import VerificationResult

class VerificationRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def record_result(self, task_id: str, contact_id: str, confidence: float,
                            decision: str, signals: List[Dict[str, Any]],
                            screenshot_path: Optional[str] = None, reason: Optional[str] = None) -> VerificationResult:
        vrf = VerificationResult(
            task_id=task_id,
            contact_id=contact_id,
            confidence=confidence,
            decision=decision,
            signals_json=json.dumps(signals),
            screenshot_path=screenshot_path,
            reason=reason
        )
        self.session.add(vrf)
        await self.session.commit()
        return vrf

    async def get_by_task(self, task_id: str) -> Optional[VerificationResult]:
        stmt = select(VerificationResult).where(VerificationResult.task_id == task_id)
        result = await self.session.execute(stmt)
        return result.scalars().first()
