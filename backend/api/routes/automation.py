from typing import Optional
from datetime import datetime, timezone
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

@router.post("/replies/scan")
async def scan_replies():
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    res = await reply_scanner_worker.scan_inbox()
    if not res.get("success"):
        raise HTTPException(400, res.get("error", "Scan failed"))
    return res

@router.get("/replies/status")
async def get_reply_scanner_status():
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    return reply_scanner_worker.get_status()

# ─────────────────────────────────────────────────────────────
# Worker 3 (Follow-Up Dispatcher) Endpoints
# ─────────────────────────────────────────────────────────────

@router.post("/worker3/start")
async def start_worker3(req: Optional[StartAutomationRequest] = None):
    from backend.workers.followup_worker import followup_worker
    try:
        batch_limit = req.batch_limit if req else None
        delay_seconds = req.delay_seconds if req else 15
        await followup_worker.start(batch_limit=batch_limit, delay_seconds=delay_seconds)
        return {
            "status": "started",
            "worker_id": "WORKER-03",
            "batch_limit": batch_limit,
            "delay_seconds": delay_seconds
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to start Worker 3: {str(e)}")

@router.post("/worker3/pause")
async def pause_worker3():
    from backend.workers.followup_worker import followup_worker
    await followup_worker.pause()
    return {"status": "paused", "worker_id": "WORKER-03"}

@router.post("/worker3/resume")
async def resume_worker3():
    from backend.workers.followup_worker import followup_worker
    await followup_worker.resume()
    return {"status": "resumed", "worker_id": "WORKER-03"}

@router.post("/worker3/stop")
async def stop_worker3():
    from backend.workers.followup_worker import followup_worker
    await followup_worker.stop()
    return {"status": "stopped", "worker_id": "WORKER-03"}

@router.get("/worker3/status")
async def worker3_status():
    from backend.workers.followup_worker import followup_worker
    return await followup_worker.health()

# ─────────────────────────────────────────────────────────────
# Coordinator & Lock Management Endpoints
# ─────────────────────────────────────────────────────────────

class CoordinatorModeRequest(BaseModel):
    mode: str

@router.get("/coordinator/status")
async def get_coordinator_status(db: AsyncSession = Depends(get_db)):
    from backend.automation.coordinator import coordinator
    from backend.database.models import Task
    from sqlalchemy import select, and_, func
    now = datetime.now(timezone.utc)
    
    # Due counts
    cold_stmt = select(func.count(Task.id)).where(and_(Task.status == "READY", Task.type == "MESSAGE", Task.scheduled_at <= now))
    fu_stmt = select(func.count(Task.id)).where(and_(Task.status == "READY", Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]), Task.scheduled_at <= now))
    
    cold_due = (await db.execute(cold_stmt)).scalar() or 0
    fu_due = (await db.execute(fu_stmt)).scalar() or 0
    
    return {
        **coordinator.get_status(),
        "cold_due_count": cold_due,
        "followup_due_count": fu_due
    }

@router.post("/coordinator/mode")
async def set_coordinator_mode(req: CoordinatorModeRequest):
    from backend.automation.coordinator import coordinator
    valid_modes = ["BALANCED", "COLD_ONLY", "FOLLOWUP_ONLY", "MANUAL"]
    if req.mode.upper() not in valid_modes:
        raise HTTPException(400, f"Invalid mode. Must be one of {valid_modes}")
    coordinator.mode = req.mode.upper()
    return {"status": "success", "mode": coordinator.mode}


