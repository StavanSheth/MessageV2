from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from backend.workers.instagram_worker import instagram_worker
from backend.repositories.task_repository import TaskRepository
from backend.database.session import get_db

router = APIRouter(prefix="/api/automation", tags=["automation"])

class StartAutomationRequest(BaseModel):
    batch_limit: Optional[int] = None
    delay_seconds: Optional[int] = 15

@router.post("/start")
async def start_automation(req: Optional[StartAutomationRequest] = None):
    """Start the Instagram worker with optional batch limit and delay."""
    try:
        batch_limit = req.batch_limit if req else None
        delay_seconds = req.delay_seconds if req else 15
        await instagram_worker.start(batch_limit=batch_limit, delay_seconds=delay_seconds)
        return {
            "status": "started",
            "batch_limit": batch_limit,
            "delay_seconds": delay_seconds
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to start worker: {str(e)}")

@router.post("/pause")
async def pause_automation():
    await instagram_worker.pause()
    return {"status": "paused"}

@router.post("/resume")
async def resume_automation():
    await instagram_worker.resume()
    return {"status": "resumed"}

@router.post("/stop")
async def stop_automation():
    await instagram_worker.stop()
    return {"status": "stopped"}

@router.get("/status")
async def automation_status(db: AsyncSession = Depends(get_db)):
    h = await instagram_worker.health()
    repo = TaskRepository(db)
    counts = await repo.count_by_status()
    return {
        **h,
        "task_counts": counts
    }

@router.get("/extension_status")
async def extension_status():
    from backend.automation.extension_bridge import extension_bridge
    return {
        "extension_connected": extension_bridge.is_connected
    }


