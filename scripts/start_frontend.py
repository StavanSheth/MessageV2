import os
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = ROOT_DIR / "apps" / "dashboard"

if __name__ == "__main__":
    print(f"Starting Vite frontend dev server in {FRONTEND_DIR}...")
    cmd = ["npm.cmd" if sys.platform == "win32" else "npm", "run", "dev"]
    try:
        subprocess.run(cmd, cwd=str(FRONTEND_DIR), check=True)
    except KeyboardInterrupt:
        print("\nFrontend server stopped.")
