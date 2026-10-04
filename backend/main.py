import sys
import asyncio
import logging

def proactor_loop_factory(use_subprocess: bool = False):
    return asyncio.ProactorEventLoop()

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.database.session import init_db
from backend.recovery.recovery_service import RecoveryService
from backend.database.session import AsyncSessionLocal
from backend.api.routes.sources import router as sources_router
from backend.api.routes.contacts import router as contacts_router
from backend.api.routes.tasks import router as tasks_router
from backend.api.routes.automation import router as automation_router
from backend.api.routes.events import router as events_router
from backend.api.routes.workers import router as workers_router
from backend.config.settings import settings, SCREENSHOTS_DIR

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting MessageV2 backend...")
    await init_db()
    logger.info("Database initialized.")

    # Run startup recovery: safely reconcile any in-flight or interrupted tasks
    async with AsyncSessionLocal() as session:
        recovery = RecoveryService(session)
        affected = await recovery.reconcile_on_startup()
        if affected:
            logger.info(f"Startup recovery complete: {affected}")

    logger.info(f"Backend ready on http://{settings.HOST}:{settings.PORT}")
    yield
    logger.info("Shutting down backend...")


app = FastAPI(
    title="MessageV2 API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS for local dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Static files for screenshots
app.mount("/screenshots", StaticFiles(directory=str(SCREENSHOTS_DIR)), name="screenshots")

# Routers
app.include_router(sources_router)
app.include_router(contacts_router)
app.include_router(tasks_router)
app.include_router(automation_router)
app.include_router(events_router)
app.include_router(workers_router)
