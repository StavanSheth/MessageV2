import os
import json
import logging
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from sqlalchemy.orm import selectinload
from backend.workers.instagram_worker import instagram_worker
from backend.repositories.task_repository import TaskRepository
from backend.database.session import get_db
from backend.database.models import Task, Contact, VerificationResult
from backend.config.settings import SCREENSHOTS_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/automation", tags=["automation"])

class StartAutomationRequest(BaseModel):
    batch_limit: Optional[int] = None
    delay_seconds: Optional[int] = 15
    random_order: Optional[bool] = False
    random_order_worker1: Optional[bool] = None
    random_order_worker3: Optional[bool] = None

class SetRandomOrderRequest(BaseModel):
    enabled: bool

@router.post("/start")
async def start_automation(req: Optional[StartAutomationRequest] = None):
    """Start the Instagram worker with optional batch limit, delay, and random order."""
    try:
        batch_limit = req.batch_limit if req else None
        delay_seconds = req.delay_seconds if req else 15
        random_order = req.random_order if (req and req.random_order is not None) else None
        await instagram_worker.start(batch_limit=batch_limit, delay_seconds=delay_seconds, random_order=random_order)
        return {
            "status": "started",
            "batch_limit": batch_limit,
            "delay_seconds": delay_seconds,
            "random_order": instagram_worker.random_order
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

    current_task_id = h.get("current_task_id")
    current_run_id = h.get("current_run_id")

    target_task = None
    if current_task_id:
        stmt = (
            select(Task)
            .options(selectinload(Task.contact), selectinload(Task.verifications), selectinload(Task.messages))
            .where(Task.id == current_task_id)
        )
        target_task = (await db.execute(stmt)).scalar_one_or_none()

    if not target_task:
        stmt = (
            select(Task)
            .options(selectinload(Task.contact), selectinload(Task.verifications), selectinload(Task.messages))
        )
        if current_run_id:
            stmt = stmt.where(Task.run_id == current_run_id)
        else:
            stmt = stmt.where(Task.worker_id == "WORKER-01")
        stmt = stmt.order_by(desc(Task.completed_at), desc(Task.updated_at)).limit(1)
        target_task = (await db.execute(stmt)).scalar_one_or_none()

    current_contact = None
    verification = None

    if target_task and target_task.contact:
        c = target_task.contact
        msg_text = target_task.messages[0].body if target_task.messages else (c.message or "Hey")
        current_contact = {
            "id": c.id,
            "name": c.name,
            "username": c.username or "",
            "instagram_url": c.instagram_url,
            "message": c.message,
            "custom_message": msg_text,
            "followup_1_message": c.followup_1_message,
            "followup_2_message": c.followup_2_message,
            "expected_followers": c.expected_followers,
            "replied_status": c.replied_status,
            "notes": c.notes,
            "task_id": target_task.id,
            "task_type": target_task.type,
            "task_status": target_task.status,
            "is_done": target_task.status in ("COMPLETED", "SENT"),
            "started_at": target_task.started_at.isoformat() if target_task.started_at else None,
            "completed_at": target_task.completed_at.isoformat() if target_task.completed_at else None
        }
        if target_task.verifications:
            latest_vrf = target_task.verifications[-1]
            sigs = []
            if latest_vrf.signals_json:
                try:
                    sigs = json.loads(latest_vrf.signals_json)
                except Exception:
                    pass
            verification = {
                "confidence": latest_vrf.confidence,
                "decision": latest_vrf.decision,
                "reason": latest_vrf.reason,
                "signals": sigs,
                "screenshot_path": latest_vrf.screenshot_path
            }

    # Fetch all previous & current target profiles processed in this run
    run_query = (
        select(Task)
        .options(selectinload(Task.contact), selectinload(Task.verifications), selectinload(Task.messages))
    )
    if current_run_id:
        run_query = run_query.where(Task.run_id == current_run_id)
    else:
        run_query = run_query.where(Task.worker_id == "WORKER-01")
    run_query = run_query.order_by(desc(Task.completed_at), desc(Task.updated_at)).limit(50)
    run_tasks = (await db.execute(run_query)).scalars().all()

    current_run_targets = []
    for t in run_tasks:
        c = t.contact
        if not c:
            continue
        vrf_dict = None
        if t.verifications:
            v = t.verifications[-1]
            sigs = []
            if v.signals_json:
                try:
                    sigs = json.loads(v.signals_json)
                except Exception:
                    pass
            vrf_dict = {
                "confidence": v.confidence,
                "decision": v.decision,
                "reason": v.reason,
                "signals": sigs
            }
        
        current_run_targets.append({
            "task_id": t.id,
            "contact_id": c.id,
            "name": c.name,
            "username": c.username or "",
            "instagram_url": c.instagram_url,
            "task_type": t.type,
            "status": t.status,
            "is_done": t.status in ("COMPLETED", "SENT"),
            "message": t.messages[0].body if t.messages else (c.message or "Hey"),
            "replied_status": c.replied_status,
            "started_at": t.started_at.isoformat() if t.started_at else None,
            "completed_at": t.completed_at.isoformat() if t.completed_at else (t.updated_at.isoformat() if t.updated_at else None),
            "verification": vrf_dict
        })

    # Latest screenshot filename on disk
    latest_screenshot = None
    try:
        matched_shots = list(SCREENSHOTS_DIR.glob("*.png")) + list(SCREENSHOTS_DIR.glob("*.jpg"))
        if matched_shots:
            latest_file = max(matched_shots, key=os.path.getmtime)
            latest_screenshot = latest_file.name
    except Exception:
        pass

    return {
        **h,
        "current_contact": current_contact,
        "verification": verification,
        "latest_screenshot": latest_screenshot,
        "current_run_targets": current_run_targets,
        "task_counts": counts
    }

@router.get("/extension_status")
async def extension_status():
    from backend.automation.extension_bridge import extension_bridge
    return {
        "extension_connected": extension_bridge.is_connected
    }

@router.get("/hardware")
async def get_hardware_status():
    """Detect NVIDIA GPU & VRAM capability per Doc 1 §11."""
    from backend.config.hardware import detect_gpu_capabilities
    return detect_gpu_capabilities()

@router.post("/replies/scan")
async def scan_replies():
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    res = await reply_scanner_worker.scan_inbox()
    if not res.get("success"):
        raise HTTPException(400, res.get("error", "Scan failed"))
    return res

@router.post("/replies/start")
async def start_replies(interval_seconds: Optional[int] = 45):
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    return await reply_scanner_worker.start(interval_seconds=interval_seconds or 45)

@router.post("/replies/pause")
async def pause_replies():
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    await reply_scanner_worker.pause()
    return {"status": "paused", "worker_id": "WORKER-02"}

@router.post("/replies/resume")
async def resume_replies():
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    await reply_scanner_worker.resume()
    return {"status": "resumed", "worker_id": "WORKER-02"}

@router.post("/replies/stop")
async def stop_replies():
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    await reply_scanner_worker.stop()
    return {"status": "stopped", "worker_id": "WORKER-02"}

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
        random_order = req.random_order if (req and req.random_order is not None) else None
        await followup_worker.start(batch_limit=batch_limit, delay_seconds=delay_seconds, random_order=random_order)
        return {
            "status": "started",
            "worker_id": "WORKER-03",
            "batch_limit": batch_limit,
            "delay_seconds": delay_seconds,
            "random_order": followup_worker.random_order
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

class MakeDueNowRequest(BaseModel):
    count: Optional[int] = None

@router.post("/worker3/make_due_now")
async def make_followups_due_now(req: Optional[MakeDueNowRequest] = None, db: AsyncSession = Depends(get_db)):
    """Fast-forward pending future follow-up tasks to NOW so they can be tested/sent immediately."""
    from backend.database.models import Task
    from sqlalchemy import select, and_
    now = datetime.now(timezone.utc)
    limit = req.count if (req and req.count and req.count > 0) else None

    stmt = (
        select(Task)
        .where(and_(Task.status == "READY", Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]), Task.scheduled_at > now))
        .order_by(Task.scheduled_at.asc())
    )
    if limit:
        stmt = stmt.limit(limit)
    tasks = (await db.execute(stmt)).scalars().all()
    if not tasks:
        return {"status": "none_found", "message": "No future follow-up tasks found to fast-forward.", "updated_count": 0}

    for t in tasks:
        t.scheduled_at = now
    await db.commit()

    return {
        "status": "success",
        "updated_count": len(tasks),
        "task_ids": [t.id for t in tasks],
        "message": f"Successfully fast-forwarded {len(tasks)} follow-up task(s) to DUE NOW."
    }

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


# ─────────────────────────────────────────────────────────────
# Master Controls: All Workers (Start All, Pause All, Resume All, Stop All)
# ─────────────────────────────────────────────────────────────

@router.post("/all/start")
async def start_all_workers(req: Optional[StartAutomationRequest] = None):
    from backend.workers.instagram_worker import instagram_worker
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    from backend.workers.followup_worker import followup_worker
    from backend.automation.coordinator import coordinator
    from backend.database.session import AsyncSessionLocal
    from backend.database.models import Task
    from sqlalchemy import select, and_, func

    batch_limit = req.batch_limit if req else None
    delay_seconds = req.delay_seconds if req else 15
    w1_rand = req.random_order_worker1 if (req and req.random_order_worker1 is not None) else (req.random_order if (req and req.random_order is not None) else None)
    w3_rand = req.random_order_worker3 if (req and req.random_order_worker3 is not None) else (req.random_order if (req and req.random_order is not None) else None)

    results = {}

    # Worker 2: Inbox Reviewer always runs concurrently on Tab B
    try:
        results["worker2"] = await reply_scanner_worker.start()
    except Exception as e:
        logger.warning(f"[AllWorkers] Worker 2 start warning: {e}")
        results["worker2"] = {"error": str(e)}

    # Check pending due tasks to prioritize properly and avoid mutual preemption thrashing
    now = datetime.now(timezone.utc)
    fu_due = 0
    cold_due = 0
    try:
        async with AsyncSessionLocal() as session:
            fu_stmt = select(func.count(Task.id)).where(
                and_(Task.status == "READY", Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]), Task.scheduled_at <= now)
            )
            cold_stmt = select(func.count(Task.id)).where(
                and_(Task.status == "READY", Task.type == "MESSAGE", Task.scheduled_at <= now)
            )
            fu_due = (await session.execute(fu_stmt)).scalar() or 0
            cold_due = (await session.execute(cold_stmt)).scalar() or 0
    except Exception as e:
        logger.warning(f"[AllWorkers] Error checking due tasks: {e}")

    mode = coordinator.mode
    if mode == "FOLLOWUP_ONLY":
        try:
            await followup_worker.start(batch_limit=batch_limit, delay_seconds=delay_seconds, random_order=w3_rand)
            results["worker3"] = {"status": "started", "random_order": followup_worker.random_order}
        except Exception as e:
            results["worker3"] = {"error": str(e)}
    elif mode == "COLD_ONLY":
        try:
            await instagram_worker.start(batch_limit=batch_limit, delay_seconds=delay_seconds, random_order=w1_rand)
            results["worker1"] = {"status": "started", "random_order": instagram_worker.random_order}
        except Exception as e:
            results["worker1"] = {"error": str(e)}
    else:  # BALANCED or MANUAL
        if fu_due > 0:
            logger.info(f"[AllWorkers] Priority: {fu_due} follow-ups are due. Starting Worker 3 first...")
            try:
                await followup_worker.start(batch_limit=batch_limit, delay_seconds=delay_seconds, random_order=w3_rand)
                results["worker3"] = {"status": "started", "priority": "followup", "random_order": followup_worker.random_order}
            except Exception as e:
                results["worker3"] = {"error": str(e)}
        else:
            logger.info(f"[AllWorkers] Priority: No follow-ups due ({cold_due} cold outreach due). Starting Worker 1...")
            try:
                await instagram_worker.start(batch_limit=batch_limit, delay_seconds=delay_seconds, random_order=w1_rand)
                results["worker1"] = {"status": "started", "priority": "outreach", "random_order": instagram_worker.random_order}
            except Exception as e:
                results["worker1"] = {"error": str(e)}

    return {"status": "started_all", "results": results}


@router.post("/random_order")
@router.post("/all/random_order")
async def set_all_random_order(req: SetRandomOrderRequest):
    from backend.workers.instagram_worker import instagram_worker
    from backend.workers.followup_worker import followup_worker
    instagram_worker.set_random_order(req.enabled)
    followup_worker.set_random_order(req.enabled)
    return {"status": "ok", "random_order": req.enabled}


@router.post("/worker1/random_order")
async def set_worker1_random_order(req: SetRandomOrderRequest):
    from backend.workers.instagram_worker import instagram_worker
    instagram_worker.set_random_order(req.enabled)
    return {"status": "ok", "worker_id": "WORKER-01", "random_order": req.enabled}


@router.post("/worker3/random_order")
async def set_worker3_random_order(req: SetRandomOrderRequest):
    from backend.workers.followup_worker import followup_worker
    followup_worker.set_random_order(req.enabled)
    return {"status": "ok", "worker_id": "WORKER-03", "random_order": req.enabled}


@router.post("/all/pause")
async def pause_all_workers():
    from backend.workers.instagram_worker import instagram_worker
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    from backend.workers.followup_worker import followup_worker

    await instagram_worker.pause()
    await reply_scanner_worker.pause()
    await followup_worker.pause()
    return {"status": "paused_all"}


@router.post("/all/resume")
async def resume_all_workers():
    from backend.workers.instagram_worker import instagram_worker
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    from backend.workers.followup_worker import followup_worker
    from backend.database.session import AsyncSessionLocal
    from backend.database.models import Task
    from sqlalchemy import select, and_, func

    results = {}

    # Worker 2: Always resume
    try:
        await reply_scanner_worker.resume()
        results["worker2"] = {"status": "resumed"}
    except Exception as e:
        results["worker2"] = {"error": str(e)}

    # For DM senders (Worker 1 vs Worker 3), determine which one has due tasks or was paused
    now = datetime.now(timezone.utc)
    fu_due = 0
    try:
        async with AsyncSessionLocal() as session:
            fu_stmt = select(func.count(Task.id)).where(
                and_(Task.status == "READY", Task.type.in_(["FOLLOW_UP_1", "FOLLOW_UP_2"]), Task.scheduled_at <= now)
            )
            fu_due = (await session.execute(fu_stmt)).scalar() or 0
    except Exception:
        pass

    if followup_worker.is_paused and fu_due > 0:
        try:
            await followup_worker.resume()
            results["worker3"] = {"status": "resumed"}
        except Exception as e:
            results["worker3"] = {"error": str(e)}
    else:
        try:
            await instagram_worker.resume()
            results["worker1"] = {"status": "resumed"}
        except Exception as e:
            results["worker1"] = {"error": str(e)}

    return {"status": "resumed_all", "results": results}


@router.post("/all/stop")
async def stop_all_workers():
    from backend.workers.instagram_worker import instagram_worker
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    from backend.workers.followup_worker import followup_worker

    await instagram_worker.stop()
    await reply_scanner_worker.stop()
    await followup_worker.stop()
    return {"status": "stopped_all"}


@router.get("/all/status")
async def get_all_workers_status():
    from backend.workers.instagram_worker import instagram_worker
    from backend.workers.reply_scanner_worker import reply_scanner_worker
    from backend.workers.followup_worker import followup_worker

    w1 = await instagram_worker.health()
    w2 = reply_scanner_worker.get_status()
    w3 = await followup_worker.health()

    w1_running = w1.get("status") == "RUNNING" and not w1.get("is_paused")
    w2_running = w2.get("status") in ("RUNNING", "SCANNING") and not w2.get("is_paused")
    w3_running = w3.get("status") == "RUNNING" and not w3.get("is_paused")

    w1_paused = w1.get("status") == "PAUSED" or bool(w1.get("is_paused"))
    w2_paused = w2.get("status") == "PAUSED" or bool(w2.get("is_paused"))
    w3_paused = w3.get("status") == "PAUSED" or bool(w3.get("is_paused"))

    any_running = w1_running or w2_running or w3_running
    any_paused = w1_paused or w2_paused or w3_paused

    return {
        "worker1": w1,
        "worker2": w2,
        "worker3": w3,
        "any_running": any_running,
        "any_paused": any_paused,
        "all_idle": not any_running and not any_paused,
        "active_count": sum([1 for r in [w1_running, w2_running, w3_running] if r]),
        "paused_count": sum([1 for p in [w1_paused, w2_paused, w3_paused] if p]),
    }


