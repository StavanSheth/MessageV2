"""
Chrome Profile Manager:
Discovers existing Chrome profiles on the user's system,
manages profile selection (defaulting to Stavan Sheth 'Default' profile),
and provides visible live Chrome browser launch controls.
"""
import os
import json
import logging
import asyncio
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

from backend.config.settings import DATA_DIR, settings

logger = logging.getLogger(__name__)

ACTIVE_PROFILE_FILE = DATA_DIR / "active_chrome_profile.json"

class ChromeProfileManager:
    def __init__(self):
        self._user_data_path = self._detect_chrome_user_data_path()
        self._active_profile_id = self._load_persisted_profile_id() or "Default"

    def _detect_chrome_user_data_path(self) -> Path:
        local_app_data = os.environ.get("LOCALAPPDATA", "")
        if local_app_data:
            standard_path = Path(local_app_data) / "Google" / "Chrome" / "User Data"
            if standard_path.exists():
                return standard_path
        # Fallback to current settings if custom
        return Path(settings.USER_DATA_DIR)

    def _load_persisted_profile_id(self) -> Optional[str]:
        if ACTIVE_PROFILE_FILE.exists():
            try:
                data = json.loads(ACTIVE_PROFILE_FILE.read_text(encoding="utf-8"))
                return data.get("active_profile_id")
            except Exception:
                pass
        return "Default"

    def _save_persisted_profile_id(self, profile_id: str) -> None:
        try:
            ACTIVE_PROFILE_FILE.write_text(
                json.dumps({"active_profile_id": profile_id}, indent=2),
                encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"Could not persist active profile ID: {e}")

    def list_profiles(self) -> List[Dict[str, Any]]:
        """
        Scan Chrome's Local State file and return all discovered profiles,
        prioritizing Stavan Sheth ('Default') as the primary default.
        """
        profiles: List[Dict[str, Any]] = []
        local_state_file = self._user_data_path / "Local State"

        if local_state_file.exists():
            try:
                with open(local_state_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                info_cache = data.get("profile", {}).get("info_cache", {})

                for prof_dir, info in info_cache.items():
                    friendly_name = info.get("name") or prof_dir
                    gaia_name = info.get("gaia_name") or ""
                    user_name = info.get("user_name") or ""  # email
                    
                    # Identify Stavan Sheth default profile
                    is_stavan_default = (
                        prof_dir.lower() == "default" or
                        "stavanasheth" in user_name.lower() or
                        "stavan sheth" in gaia_name.lower()
                    )

                    label_parts = []
                    if gaia_name:
                        label_parts.append(gaia_name)
                    elif friendly_name:
                        label_parts.append(friendly_name)

                    if user_name:
                        label_parts.append(f"({user_name})")
                    else:
                        label_parts.append(f"[{prof_dir}]")

                    if is_stavan_default:
                        label_parts.append("[Default]")

                    display_label = " ".join(label_parts)

                    profiles.append({
                        "id": prof_dir,
                        "name": friendly_name,
                        "gaia_name": gaia_name,
                        "email": user_name,
                        "is_default": is_stavan_default,
                        "display_label": display_label,
                        "is_active": (prof_dir == self._active_profile_id)
                    })
            except Exception as e:
                logger.error(f"Error reading Chrome Local State: {e}")

        # If no profiles detected (e.g. non-standard path), ensure Default is present
        if not profiles:
            profiles.append({
                "id": "Default",
                "name": "Stavan Sheth",
                "gaia_name": "STAVAN SHETH",
                "email": "stavanasheth@gmail.com",
                "is_default": True,
                "display_label": "Stavan Sheth (stavanasheth@gmail.com) [Default]",
                "is_active": True
            })

        # Sort so that Default / Stavan Sheth is always first
        profiles.sort(key=lambda p: (not p["is_default"], p["id"] != self._active_profile_id, p["name"]))
        return profiles

    def get_active_profile_id(self) -> str:
        """Returns the currently active Chrome profile directory (default: 'Default')."""
        return self._active_profile_id

    def get_active_profile(self) -> Dict[str, Any]:
        """Returns details for the currently active profile."""
        all_profiles = self.list_profiles()
        for p in all_profiles:
            if p["id"] == self._active_profile_id:
                return p
        return all_profiles[0] if all_profiles else {
            "id": "Default",
            "name": "Stavan Sheth",
            "gaia_name": "STAVAN SHETH",
            "email": "stavanasheth@gmail.com",
            "is_default": True,
            "display_label": "Stavan Sheth (stavanasheth@gmail.com) [Default]",
            "is_active": True
        }

    def set_active_profile(self, profile_id: str) -> Dict[str, Any]:
        """Sets the active profile ID and persists it."""
        all_profiles = self.list_profiles()
        valid_ids = {p["id"] for p in all_profiles}
        if profile_id not in valid_ids and profile_id != "Default":
            raise ValueError(f"Unknown Chrome profile '{profile_id}'. Valid options: {list(valid_ids)}")

        self._active_profile_id = profile_id
        self._save_persisted_profile_id(profile_id)
        logger.info(f"Switched active Chrome profile to '{profile_id}'")
        return self.get_active_profile()

    async def launch_chrome_live(self, profile_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Launches Google Chrome visibly on screen with the specified or active profile,
        enabling remote debugging on port 9222 and bringing the window to the front.
        """
        from backend.automation.instagram.browser import get_chrome_executable, check_cdp_endpoint

        target_profile = profile_id or self._active_profile_id or "Default"
        self._active_profile_id = target_profile
        self._save_persisted_profile_id(target_profile)

        chrome_bin = get_chrome_executable()
        cdp_url = check_cdp_endpoint()

        # If Chrome with port 9222 is not already running, launch it
        if not cdp_url and os.name == "nt":
            cmd = f'cmd.exe /c start "" "{chrome_bin}" --remote-debugging-port=9222 --profile-directory="{target_profile}" --restore-last-session http://localhost:5173 https://www.instagram.com'
            logger.info(f"Launching visible Chrome: {cmd}")
            subprocess.Popen(cmd, shell=True)

            # Wait for CDP endpoint to become ready
            for _ in range(8):
                await asyncio.sleep(0.4)
                cdp_url = check_cdp_endpoint()
                if cdp_url:
                    break

        # Bring Chrome window to front on desktop so it's live on screen
        self.bring_chrome_to_front()

        active_profile = self.get_active_profile()
        return {
            "status": "launched",
            "cdp_url": cdp_url,
            "profile": active_profile,
            "chrome_binary": chrome_bin,
            "live_on_screen": True
        }

    def bring_chrome_to_front(self) -> bool:
        """Utility to ensure Chrome window is foregrounded on the Windows desktop."""
        if os.name != "nt":
            return False
        try:
            ps_script = (
                "$procs = Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }; "
                "if ($procs) { "
                "  $w = Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);' -Name 'Win32Fore' -Namespace 'Win32' -PassThru; "
                "  foreach ($p in $procs) { [Win32.Win32Fore]::ShowWindow($p.MainWindowHandle, 9); [Win32.Win32Fore]::SetForegroundWindow($p.MainWindowHandle); } "
                "}"
            )
            subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, timeout=3)
            return True
        except Exception as e:
            logger.debug(f"Could not foreground Chrome window: {e}")
            return False

# Global singleton
chrome_profile_manager = ChromeProfileManager()
