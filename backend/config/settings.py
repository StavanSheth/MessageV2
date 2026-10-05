import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DATABASE_DIR = DATA_DIR / "database"
PROFILES_DIR = DATA_DIR / "browser_profiles" / "instagram"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
LOGS_DIR = DATA_DIR / "logs"
CACHE_DIR = DATA_DIR / "cache"

# Ensure directories exist
for d in [DATA_DIR, DATABASE_DIR, PROFILES_DIR, SCREENSHOTS_DIR, LOGS_DIR, CACHE_DIR]:
    d.mkdir(parents=True, exist_ok=True)

class Settings(BaseSettings):
    APP_ENV: str = "development"
    DATABASE_URL: str = f"sqlite+aiosqlite:///{DATABASE_DIR / 'app.db'}"
    SYNC_DATABASE_URL: str = f"sqlite:///{DATABASE_DIR / 'app.db'}"

    # Browser & Playwright
    BROWSER_HEADLESS: bool = False
    BROWSER_SLOW_MO: int = 100
    BROWSER_TIMEOUT: int = 30000
    TASK_TIMEOUT: int = 60000
    USER_DATA_DIR: str = str(PROFILES_DIR)

    # Automation Rules
    MESSAGE_MODE: str = "automatic"  # automatic or manual
    WORKER_MODE: str = "single"     # single or multi
    MAX_WORKERS: int = 1
    RETRY_LIMIT: int = 3
    MAX_SEND_RETRIES: int = 3
    NETWORK_BACKOFF_BASE: float = 2.0
    VERIFICATION_THRESHOLD: float = 0.75
    DEFAULT_MESSAGE: str = "Hey"

    # Vision & Observability
    SCREENSHOT_ENABLED: bool = True
    OCR_ENABLED: bool = True
    LOG_LEVEL: str = "INFO"

    # API
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DASHBOARD_PORT: int = 5173

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
