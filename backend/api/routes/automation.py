from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from backend.workers.instagram_worker import instagram_worker
from backend.repositories.task_repository import TaskRepository
from backend.database.session import get_db

router = APIRouter(prefix="/api/automation", tags=["automation"])

@router.post("/start")
async def start_automation():
    """Start the Instagram worker."""
    try:
        await instagram_worker.start()
        return {"status": "started"}
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

