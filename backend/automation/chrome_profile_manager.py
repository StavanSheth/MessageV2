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

    def get_automation_user_data_path(self) -> Path:
        """Returns the isolated User Data path for Desktop Chrome Automation."""
        if os.name == "nt":
            local_app_data = os.environ.get("LOCALAPPDATA", "")
            if local_app_data:
                auto_path = Path(local_app_data) / "Google" / "Chrome" / "User Data - Automation"
                auto_path.mkdir(parents=True, exist_ok=True)
                return auto_path
        return Path(settings.USER_DATA_DIR)

    def sync_profile_to_live_dir(self, profile_id: str) -> Path:
        """Ensures the automation profile directory exists without creating any junctions or locks."""
        target_dir = self.get_automation_user_data_path()
        (target_dir / profile_id).mkdir(parents=True, exist_ok=True)
        return target_dir

    def ensure_desktop_shortcut(self) -> Optional[Path]:
        """Creates or updates the Desktop Chrome shortcut on the user's Windows desktop."""
        if os.name != "nt":
            return None
        try:
            desktop_dir = Path(os.environ.get("USERPROFILE", "")) / "Desktop"
            if not desktop_dir.exists():
                return None
            shortcut_path = desktop_dir / "Google Chrome (Automation).lnk"
            from backend.automation.instagram.browser import get_chrome_executable
            chrome_bin = get_chrome_executable()
            auto_user_data = self.get_automation_user_data_path()
            target_profile = self._active_profile_id or "Default"
            args = (
                f'--user-data-dir="{auto_user_data}" '
                f'--profile-directory="{target_profile}" '
                f'--remote-debugging-port=9222 '
                f'--remote-allow-origins=* '
                f'--start-maximized '
                f'http://localhost:5173 https://www.instagram.com'
            )
            ps_script = f"""
            $ws = New-Object -ComObject WScript.Shell
            $s = $ws.CreateShortcut('{shortcut_path}')
            $s.TargetPath = '{chrome_bin}'
            $s.Arguments = '{args}'
            $s.Save()
            """
            subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, timeout=5)
            return shortcut_path
        except Exception as e:
            logger.debug(f"Could not create desktop shortcut: {e}")
            return None

    async def sync_from_db(self, session) -> str:
        """Loads and syncs the persistent default Chrome profile from the database."""
        from backend.repositories.setting_repository import SettingRepository
        try:
            repo = SettingRepository(session)
            saved_profile = await repo.get_value("default_chrome_profile")
            if saved_profile:
                self._active_profile_id = saved_profile
                self._save_persisted_profile_id(saved_profile)
                return saved_profile
        except Exception as e:
            logger.debug(f"Could not load profile from DB: {e}")
        return self._active_profile_id

    async def save_to_db(self, profile_id: str, session) -> None:
        """Saves the active Chrome profile to the database settings table."""
        from backend.repositories.setting_repository import SettingRepository
        try:
            repo = SettingRepository(session)
            await repo.set_value(
                key="default_chrome_profile",
                value=profile_id,
                description="Default Chrome browser profile used for live Instagram automation"
            )
        except Exception as e:
            logger.warning(f"Could not save profile to DB: {e}")

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

        # Prioritize already-running Desktop Chrome session on port 9222
        if cdp_url:
            logger.info(f"Prioritizing active Desktop Chrome session at {cdp_url}")
            return {
                "status": "connected",
                "cdp_url": cdp_url,
                "profile": self.get_active_profile(),
                "chrome_binary": chrome_bin,
                "mode": "desktop",
                "live_on_screen": True
            }

        # If Desktop Chrome with port 9222 is not already running, launch natively via ShellExecute (zero cmd.exe)
        if os.name == "nt":
            auto_user_data = self.get_automation_user_data_path()
            self.ensure_desktop_shortcut()
            self.sync_profile_to_live_dir(target_profile)

            args = (
                f'--user-data-dir="{auto_user_data}" '
                f'--profile-directory="{target_profile}" '
                f'--remote-debugging-port=9222 '
                f'--remote-allow-origins=* '
                f'--start-maximized '
                f'--no-first-run '
                f'--no-default-browser-check '
                f'http://localhost:5173 https://www.instagram.com'
            )

            try:
                # Pure Windows native launch (identical to desktop icon click, zero cmd.exe)
                os.startfile(chrome_bin, arguments=args)
                logger.info("Launched Desktop Chrome via native Windows ShellExecute (no cmd)")
            except Exception as e:
                logger.warning(f"Native desktop startfile error: {e}")

            # Wait for CDP endpoint to become ready
            for _ in range(12):
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
        """Utility to ensure Chrome window is un-minimized, maximized, and foregrounded on the Windows desktop."""
        if os.name != "nt":
            return False
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            WM_SYSCOMMAND = 0x0112
            SC_RESTORE = 0xF120
            SC_MAXIMIZE = 0xF030
            SW_RESTORE = 9
            SW_SHOWMAXIMIZED = 3

            try:
                hwinsta = user32.OpenWindowStationA(b"WinSta0", False, 0x10000000)
                if hwinsta:
                    user32.SetProcessWindowStation(hwinsta)
                hdesk = user32.OpenDesktopA(b"Default", 0, False, 0x10000000)
                if hdesk:
                    user32.SetThreadDesktop(hdesk)
            except Exception:
                pass

            def enum_cb(hwnd, lparam):
                if user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buff = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buff, length + 1)
                        title = buff.value.lower()
                        if "chrome" in title or "instagram" in title or "dashboard" in title:
                            # PostMessage SC_RESTORE and SC_MAXIMIZE directly to Chrome's window message loop
                            user32.PostMessageW(hwnd, WM_SYSCOMMAND, SC_RESTORE, 0)
                            user32.PostMessageW(hwnd, WM_SYSCOMMAND, SC_MAXIMIZE, 0)
                            user32.ShowWindowAsync(hwnd, SW_RESTORE)
                            user32.ShowWindow(hwnd, SW_SHOWMAXIMIZED)
                            user32.SetForegroundWindow(hwnd)
                            user32.BringWindowToTop(hwnd)
                            user32.SwitchToThisWindow(hwnd, True)
                return True

            WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
            user32.EnumWindows(WNDENUMPROC(enum_cb), 0)
            return True
        except Exception as e:
            logger.debug(f"Could not foreground Chrome window: {e}")
            return False

# Global singleton
chrome_profile_manager = ChromeProfileManager()

