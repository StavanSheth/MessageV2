# MessageV2 — Instagram DM Automation Suite (MVP)

A reliable, local desktop/web-hybrid automation application for Instagram outreach using visible Playwright Chrome, SQLite state tracking, and a React + Vite + Tailwind dashboard.

---

## Key Guarantees & Constraints

1. **Always-Visible Chrome (`headless=False`)**: The automation browser is always displayed on screen so you can observe all interactions in real-time.
2. **Zero Instagram Credential Storage**: No username or password for Instagram is stored in the database or config. Log in directly in the visible Chrome window once, and your session cookies are stored in a persistent local browser profile (`data/browser_profiles/instagram/`).
3. **Fail-Closed Architecture**: If an unexpected dialog, network hiccup, or unknown state occurs, tasks transition to `MANUAL_REVIEW` or `RETRY_WAIT` instead of guessing or double-sending.
4. **4-Signal Identity Verification**: Before messaging, target profiles are verified against URL, username, display name, and followers to prevent sending to incorrect profiles.
5. **Humanized Interaction**: Keystroke delays, Gaussian intervals, and rate-limiting safeguards prevent bot-detection flags.

---

## Project Structure

```text
MessageV2/
├── backend/
│   ├── api/routes/              # FastAPI REST & WebSocket endpoints
│   ├── automation/instagram/    # Playwright browser worker, selectors, adapter
│   ├── config/                  # Settings via pydantic-settings
│   ├── database/                # SQLAlchemy models & SQLite async session
│   ├── domain/                  # Enums, Pydantic schemas, state machine
│   ├── events/                  # WebSocket event bus broadcaster
│   ├── recovery/                # Crash recovery and startup reconciler
│   ├── repositories/            # Data access layers (Tasks, Contacts, Workers, etc.)
│   ├── sources/                 # Local XLSX and Google Sheets adapters
│   ├── verification/            # Multi-signal identity verification service
│   ├── vision/                  # Vision and OCR modules (pluggable)
│   └── workers/                 # Background Instagram dispatch worker
├── apps/
│   └── dashboard/               # React 19 + TypeScript + Vite + Tailwind CSS
├── scripts/
│   ├── start_dev.py             # Orchestrator running backend & frontend
│   ├── start_backend.py         # Standalone backend launcher
│   └── start_frontend.py        # Standalone frontend launcher
├── tests/
│   ├── integration/             # FastAPI integration tests
│   └── unit/                    # State machine, verification, XLSX tests
├── data/                        # Persistent browser profiles, SQLite DB, screenshots
├── start.bat                    # Windows one-click launcher
└── requirements.txt             # Python dependencies
```

---

## Quick Start (Windows)

### 1. Prerequisites
- Python 3.12 (`py -3.12`)
- Node.js (v18+) & npm

### 2. Environment Setup (First Time)
Run the following in PowerShell from `C:\Projects\MessageV2`:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\playwright install chromium
cd apps\dashboard
npm install
cd ..\..
```

### 3. Launching Application
Double-click `start.bat` or run:
```powershell
.venv\Scripts\python scripts\start_dev.py
```

This will automatically:
1. Initialize the SQLite database at `data/messagev2.db`.
2. Start the FastAPI backend on `http://127.0.0.1:8000`.
3. Start the Vite React dashboard on `http://localhost:5173`.
4. Open your browser to the dashboard.

---

## Workflow Guide

1. **Import Spreadsheet**:
   - Go to the **Sources** tab.
   - Upload an `.xlsx` file or enter a Google Sheets URL.
   - Headers recognized automatically: *Instagram URL*, *Username*, *Name*, *Message*.
2. **Review Contacts & Queue**:
   - Inspect loaded leads in the **Contacts** and **Queue** tabs.
3. **Launch Automation**:
   - Click **START RUN** in the top navigation bar.
   - A visible Google Chrome window will appear on screen.
   - If not logged in, log in directly on Instagram in the Chrome window.
   - The worker detects login automatically and begins processing tasks sequentially.
4. **Watch Live Feed**:
   - The **Live Automation** tab updates with the active contact, verification score, and action checkpoints.
   - Audit logs and screenshots are captured in the **Audit Log** tab.
5. **Inbound Tracking**:
   - In the **Contacts** tab, click **Mark Replied** when leads respond.

---

## Running Automated Tests

```powershell
.venv\Scripts\pytest -v tests
```
