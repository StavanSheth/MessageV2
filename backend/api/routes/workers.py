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

from fastapi.responses import FileResponse, Response

@router.get("/screenshots/{filename}")
async def get_screenshot(filename: str):
    path = SCREENSHOTS_DIR / filename
    if path.exists() and path.is_file():
        return FileResponse(str(path), media_type="image/png")
    return {"error": "Screenshot not found"}

@router.get("/api/browser/live_feed")
async def get_browser_live_feed():
    bw = instagram_worker.browser_worker
    target_url = instagram_worker.current_instagram if instagram_worker.status.value == "RUNNING" else None
    img_bytes = await bw.capture_live_screenshot(target_url=target_url)
    if img_bytes:
        return Response(
            content=img_bytes,
            media_type="image/jpeg",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )
    # If no live page, return latest file from screenshots dir if available
    screenshots = sorted(list(SCREENSHOTS_DIR.glob("*.png")), key=os.path.getmtime, reverse=True)
    if screenshots:
        return FileResponse(str(screenshots[0]), media_type="image/png")
    return Response(status_code=204)

from pydantic import BaseModel
from typing import Optional

class ProfileSelectRequest(BaseModel):
    profile_id: Optional[str] = "Default"

@router.get("/api/browser/profiles")
async def list_browser_profiles(db: AsyncSession = Depends(get_db)):
    """Lists all detected Chrome profiles on the host machine, prioritizing Stavan Sheth (Default)."""
    from backend.automation.chrome_profile_manager import chrome_profile_manager
    await chrome_profile_manager.sync_from_db(db)
    profiles = chrome_profile_manager.list_profiles()
    active = chrome_profile_manager.get_active_profile()
    return {
        "profiles": profiles,
        "active_profile": active
    }

@router.get("/api/browser/profile/active")
async def get_active_browser_profile(db: AsyncSession = Depends(get_db)):
    from backend.automation.chrome_profile_manager import chrome_profile_manager
    await chrome_profile_manager.sync_from_db(db)
    return chrome_profile_manager.get_active_profile()

@router.post("/api/browser/profile/select")
async def select_browser_profile(req: ProfileSelectRequest, db: AsyncSession = Depends(get_db)):
    from backend.automation.chrome_profile_manager import chrome_profile_manager
    from fastapi import HTTPException
    try:
        updated = chrome_profile_manager.set_active_profile(req.profile_id or "Default")
        await chrome_profile_manager.save_to_db(updated["id"], db)
        return {
            "status": "selected",
            "active_profile": updated
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/api/browser/open")
@router.post("/api/browser/launch")
async def open_visible_browser(req: Optional[ProfileSelectRequest] = None):
    """Forces open or foregrounds the native Chrome browser window on the user desktop live on screen."""
    from backend.automation.chrome_profile_manager import chrome_profile_manager
    from fastapi import HTTPException

    target_profile = (req.profile_id if req and req.profile_id else None) or chrome_profile_manager.get_active_profile_id() or "Default"
    chrome_profile_manager.set_active_profile(target_profile)

    try:
        launch_info = await chrome_profile_manager.launch_chrome_live(target_profile)
        await instagram_worker.browser_worker.start()
        chrome_profile_manager.bring_chrome_to_front()
        return {
            "status": "opened",
            "browser_status": "CONNECTED",
            "playwright_connected": True,
            "profile": chrome_profile_manager.get_active_profile(),
            "live_on_screen": True
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "BROWSER_STARTUP_FAILED",
                "browser_status": "DISCONNECTED",
                "playwright_connected": False,
                "profile": target_profile,
                "failure_reason": str(e)
            }
        )

