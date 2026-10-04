import os
import sys
import subprocess
import time
import webbrowser
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

def run_dev():
    print("=" * 60)
    print("   MessageV2 - Instagram DM Automation Suite (Dev Mode)")
    print("=" * 60)

    # 1. Start Backend in subprocess
    print("[1/3] Starting backend FastAPI service...")
    python_bin = sys.executable
    backend_script = ROOT_DIR / "scripts" / "start_backend.py"
    backend_proc = subprocess.Popen(
        [python_bin, str(backend_script)],
        cwd=str(ROOT_DIR),
    )

    # Give backend a moment to boot
    time.sleep(2)

    # 2. Start Frontend dev server
    print("[2/3] Starting frontend dashboard...")
    frontend_dir = ROOT_DIR / "apps" / "dashboard"
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_proc = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=str(frontend_dir),
    )

    # 3. Open Dashboard in Default Browser
    time.sleep(2)
    print("[3/3] Opening dashboard in browser at http://localhost:5173 ...")
    webbrowser.open("http://localhost:5173")

    print("\nSystem running! Press Ctrl+C to terminate both servers.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nShutting down dev servers...")
        frontend_proc.terminate()
        backend_proc.terminate()
        frontend_proc.wait()
        backend_proc.wait()
        print("Shutdown complete.")

if __name__ == "__main__":
    run_dev()
