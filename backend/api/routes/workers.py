import json
import os
from pathlib import Path
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from backend.database.session import get_db
from backend.repositories.worker_repository import WorkerRepository
from backend.workers.instagram_worker import instagram_worker
from backend.config.settings import settings, SCREENSHOTS_DIR

router = APIRouter(tags=["workers"])

@router.get("/api/workers")
async def list_workers(db: AsyncSession = Depends(get_db)):
    repo = WorkerRepository(db)
    workers = await repo.list_workers()
    return [{
        "id": w.id,
        "name": w.name,
        "status": w.status,
        "browser_status": w.browser_status,
        "instagram_login_status": w.instagram_login_status,
        "current_task_id": w.current_task_id,
        "current_stage": w.current_stage,
        "current_url": w.current_url,
        "last_heartbeat_at": w.last_heartbeat_at
    } for w in workers]

@router.get("/api/worker/live")
async def worker_live_state():
    return await instagram_worker.health()

@router.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "MessageV2 Backend"}

@router.get("/screenshots/{filename}")
async def get_screenshot(filename: str):
    path = SCREENSHOTS_DIR / filename
    if path.exists() and path.is_file():
        return FileResponse(str(path), media_type="image/png")
    return {"error": "Screenshot not found"}
