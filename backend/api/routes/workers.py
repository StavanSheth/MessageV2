import json
import os
from pathlib import Path
from fastapi import APIRouter, Depends, Response
from fastapi.responses import FileResponse, StreamingResponse
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

@router.get("/api/browser/stream")
@router.get("/api/browser/stream/outreach")
async def browser_stream_outreach(worker: str = "outreach"):
    """MJPEG continuous live video stream for Worker 1 (Outreach Dispatcher Tab)."""
    return await _stream_worker(worker="outreach")

@router.get("/api/browser/stream/replies")
async def browser_stream_replies():
    """MJPEG continuous live video stream for Worker 2 (Reply Scanner Tab)."""
    return await _stream_worker(worker="scanner")

async def _stream_worker(worker: str = "outreach"):
    from backend.automation.extension_bridge import extension_bridge
    import asyncio

    if extension_bridge.is_connected:
        try:
            await extension_bridge.start_screencast()
        except Exception:
            pass

    async def frame_generator():
        last_sent = None
        while True:
            # 1. First priority: live frame from extension screencast for this worker
            frame = await extension_bridge.wait_for_next_frame(worker=worker, timeout=0.6)
            if not frame:
                # 2. Secondary priority: active capture screenshot for this worker tab
                frame = await extension_bridge.capture_screenshot(worker=worker)
            if not frame and worker == "outreach":
                # 3. Third priority: Playwright/CDP screenshot if available
                bw = instagram_worker.browser_worker
                target_url = instagram_worker.current_instagram if instagram_worker.status.value == "RUNNING" else None
                frame = await bw.capture_live_screenshot(target_url=target_url)

            if frame:
                last_sent = frame
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n" +
                    frame + b"\r\n"
                )
            elif last_sent:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(last_sent)).encode() + b"\r\n\r\n" +
                    last_sent + b"\r\n"
                )
            await asyncio.sleep(0.04)

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Connection": "keep-alive"
        }
    )

@router.get("/api/browser/live_feed")
async def get_browser_live_feed(worker: str = "outreach"):
    from backend.automation.extension_bridge import extension_bridge
    if extension_bridge.is_connected:
        ext_bytes = await extension_bridge.capture_screenshot(worker=worker)
        if ext_bytes:
            return Response(
                content=ext_bytes,
                media_type="image/jpeg",
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )

    if worker == "outreach":
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
    target_pattern = f"*{worker}*.jpg" if worker in ("scanner", "outreach") else "*.jpg"
    matched_shots = list(SCREENSHOTS_DIR.glob(target_pattern))
    if not matched_shots:
        matched_shots = list(SCREENSHOTS_DIR.glob("*.jpg")) + list(SCREENSHOTS_DIR.glob("*.png"))
    screenshots = sorted(matched_shots, key=os.path.getmtime, reverse=True)
    if screenshots:
        ext = screenshots[0].suffix.lower()
        media_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"
        return FileResponse(str(screenshots[0]), media_type=media_type)
    return Response(status_code=204)

@router.get("/api/browser/capture_test")
async def test_browser_capture():
    from backend.automation.extension_bridge import extension_bridge
    if not extension_bridge.is_connected:
        return {"connected": False, "error": "Extension bridge not connected"}
    try:
        res = await extension_bridge.send_command("CAPTURE_SCREENSHOT", timeout=5.0)
        has_data = bool(res.get("dataUrl"))
        data_len = len(res.get("dataUrl", ""))
        return {"connected": True, "res_keys": list(res.keys()), "success": res.get("success"), "error": res.get("error"), "has_data": has_data, "data_len": data_len}
    except Exception as e:
        return {"connected": True, "error": str(e)}

@router.post("/api/browser/reload_extension")
async def reload_extension_endpoint():
    from backend.automation.extension_bridge import extension_bridge
    if not extension_bridge.is_connected:
        return {"success": False, "error": "Extension bridge not connected"}
    try:
        res = await extension_bridge.reload_extension()
        return res
    except Exception as e:
        return {"success": False, "error": str(e)}

@router.post("/api/browser/open")
async def open_visible_browser():
    """Forces open or foregrounds the native Chrome browser window on the user desktop."""
    from backend.automation.instagram.browser import check_cdp_endpoint
    cdp_url = check_cdp_endpoint()
    
    # If Chrome with CDP is already active, simply bring existing Instagram tab to front
    if cdp_url:
        try:
            page = await instagram_worker.browser_worker.get_active_instagram_page()
            if page and not page.is_closed():
                await page.bring_to_front()
                return {"status": "foregrounded"}
        except Exception:
            pass

    if os.name == "nt":
        import subprocess
        from backend.automation.instagram.browser import get_chrome_executable
        chrome_bin = get_chrome_executable()
        subprocess.Popen(f'cmd.exe /c start "" "{chrome_bin}" --remote-debugging-port=9222 --profile-directory="Default" --restore-last-session http://localhost:5173 https://www.instagram.com', shell=True)
    try:
        await instagram_worker.browser_worker.start()
        return {"status": "opened"}
    except Exception as e:
        return {"status": "launched", "note": str(e)}

