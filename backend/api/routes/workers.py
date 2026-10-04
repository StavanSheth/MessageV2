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

@router.post("/api/browser/open")
async def open_visible_browser():
    """Forces open or foregrounds the native Chrome browser window on the user desktop."""
    from backend.automation.instagram.browser import check_cdp_endpoint
    from fastapi import HTTPException
    import psutil
    
    cdp_url = check_cdp_endpoint()
    
    # If Chrome with CDP is already active, simply bring existing Instagram tab to front
    if cdp_url:
        try:
            page = await instagram_worker.browser_worker.get_active_instagram_page()
            if page and not page.is_closed():
                await page.bring_to_front()
                return {
                    "status": "foregrounded",
                    "browser_status": "CONNECTED",
                    "cdp_url": cdp_url,
                    "playwright_connected": True
                }
        except Exception:
            pass

    chrome_pid = None
    if os.name == "nt":
        import subprocess
        from backend.automation.instagram.browser import get_chrome_executable
        chrome_bin = get_chrome_executable()
        proc = subprocess.Popen(
            f'cmd.exe /c start "" "{chrome_bin}" --remote-debugging-port=9222 --profile-directory="Profile 4" --restore-last-session http://localhost:5173 https://www.instagram.com',
            shell=True
        )
        chrome_pid = proc.pid

    try:
        await instagram_worker.browser_worker.start()
        return {
            "status": "opened",
            "browser_status": "CONNECTED",
            "playwright_connected": True,
            "chrome_pid": chrome_pid
        }
    except Exception as e:
        # Strict requirement: failure MUST return 500 with structured diagnostic error
        raise HTTPException(
            status_code=500,
            detail={
                "error": "BROWSER_STARTUP_FAILED",
                "browser_status": "DISCONNECTED",
                "playwright_connected": False,
                "chrome_pid": chrome_pid,
                "failure_reason": str(e)
            }
        )

