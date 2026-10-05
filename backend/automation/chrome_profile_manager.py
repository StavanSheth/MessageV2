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

    # Path to the user's real STAVAN Chrome shortcut on OneDrive Desktop
    STAVAN_CHROME_LNK = Path(os.environ.get("USERPROFILE", "")) / "OneDrive" / "Desktop" / "STAVAN Chrome.lnk"
    AUTOMATION_USER_DATA_DIR = Path(r"C:\ChromeAutomation")

    def get_stavan_shortcut_path(self) -> Path:
        """Returns the path to STAVAN Chrome.lnk on the OneDrive Desktop."""
        return self.STAVAN_CHROME_LNK

    def sync_login_state_if_needed(self) -> None:
        """
        Synchronizes cookies, preferences, and decryption keys from the user's
        real Chrome profile so Instagram is already logged in inside ChromeAutomation.
        """
        import shutil
        src_user_data = self._user_data_path
        dest_user_data = self.AUTOMATION_USER_DATA_DIR
        dest_default = dest_user_data / "Default"
        dest_default.mkdir(parents=True, exist_ok=True)

        try:
            # Copy Local State (encryption keys for DPAPI cookie decryption)
            src_ls = src_user_data / "Local State"
            dest_ls = dest_user_data / "Local State"
            if src_ls.exists() and not dest_ls.exists():
                shutil.copy2(src_ls, dest_ls)

            # Copy Network folder (containing modern Cookies sqlite database)
            src_net = src_user_data / "Default" / "Network"
            dest_net = dest_default / "Network"
            if src_net.exists() and not (dest_net / "Cookies").exists():
                shutil.copytree(src_net, dest_net, dirs_exist_ok=True)

            # Copy Preferences
            src_pref = src_user_data / "Default" / "Preferences"
            dest_pref = dest_default / "Preferences"
            if src_pref.exists() and not dest_pref.exists():
                shutil.copy2(src_pref, dest_pref)
        except Exception as e:
            logger.debug(f"Could not auto-sync login state: {e}")

    def ensure_shortcut_has_debugging_port(self) -> bool:
        """
        Ensures the STAVAN Chrome shortcut on the desktop has:
        --remote-debugging-port=9222 --remote-allow-origins=*
        This enables remote debugging on the user's standard everyday Chrome profile.
        """
        lnk = self.get_stavan_shortcut_path()
        if not lnk.exists():
            logger.warning(f"STAVAN Chrome shortcut not found at {lnk}")
            return False
        try:
            ps_cmd = f"""$w = New-Object -ComObject WScript.Shell
$s = $w.CreateShortcut('{lnk}')
$changed = $false
if ($s.Arguments -notmatch 'remote-debugging-port=9222') {{
    $s.Arguments = '--remote-debugging-port=9222 --remote-allow-origins=*'
    $changed = $true
}}
if ($s.Arguments -match 'ChromeAutomation') {{
    $s.Arguments = '--remote-debugging-port=9222 --remote-allow-origins=*'
    $changed = $true
}}
if ($changed) {{
    $s.Save()
    Write-Output 'UPDATED'
}} else {{
    Write-Output 'OK'
}}"""
            res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd],
                                 capture_output=True, text=True, timeout=5)
            result = res.stdout.strip()
            if result == "UPDATED":
                logger.info("Updated STAVAN Chrome shortcut with --remote-debugging-port=9222")
            return True
        except Exception as e:
            logger.debug(f"Could not verify shortcut: {e}")
            return False

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
        Launches Google Chrome using the STAVAN Chrome.lnk shortcut from OneDrive Desktop.
        This uses the user's desktop Chrome shortcut with port 9222 so it appears live on screen.
        """
        from backend.automation.instagram.browser import get_chrome_executable, check_cdp_endpoint

        target_profile = profile_id or self._active_profile_id or "Default"
        self._active_profile_id = target_profile
        self._save_persisted_profile_id(target_profile)

        chrome_bin = get_chrome_executable()
        cdp_url = check_cdp_endpoint()

        # Priority 1: Already-running Desktop Chrome with port 9222
        if cdp_url:
            logger.info(f"Connected to active Desktop Chrome at {cdp_url}")
            self.bring_chrome_to_front()
            return {
                "status": "connected",
                "cdp_url": cdp_url,
                "profile": self.get_active_profile(),
                "chrome_binary": chrome_bin,
                "mode": "desktop",
                "live_on_screen": True
            }

        # Priority 2: Sync login state and launch via Desktop shortcut or direct binary
        self.sync_login_state_if_needed()

        if os.name == "nt":
            lnk = self.get_stavan_shortcut_path()
            self.ensure_shortcut_has_debugging_port()

            if lnk.exists():
                try:
                    subprocess.Popen(["explorer.exe", str(lnk)])
                    logger.info(f"Launched Chrome via STAVAN Chrome shortcut: {lnk}")
                except Exception as e:
                    logger.warning(f"Could not launch via explorer.exe: {e}, falling back to direct binary")
                    args = [
                        chrome_bin,
                        '--remote-debugging-port=9222',
                        '--remote-allow-origins=*',
                        '--start-maximized',
                        'https://www.instagram.com'
                    ]
                    subprocess.Popen(args)
            else:
                args = [
                    chrome_bin,
                    '--remote-debugging-port=9222',
                    '--remote-allow-origins=*',
                    '--start-maximized',
                    'https://www.instagram.com'
                ]
                subprocess.Popen(args)

            # Wait for CDP endpoint to become ready
            for _ in range(25):
                await asyncio.sleep(0.4)
                cdp_url = check_cdp_endpoint()
                if cdp_url:
                    break

        # Bring Chrome window to front on desktop
        self.bring_chrome_to_front()

        active_profile = self.get_active_profile()
        return {
            "status": "launched" if cdp_url else "failed_to_connect",
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
                        # Never resize or disturb the dashboard tab
                        if "dashboard" in title or "localhost" in title or "5173" in title:
                            return True
                        if "instagram" in title:
                            if user32.IsIconic(hwnd):
                                user32.ShowWindow(hwnd, 9)  # SW_RESTORE only if minimized
                            user32.SetForegroundWindow(hwnd)
                            user32.BringWindowToTop(hwnd)
                return True

            WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
            user32.EnumWindows(WNDENUMPROC(enum_cb), 0)
            return True
        except Exception as e:
            logger.debug(f"Could not foreground Chrome window: {e}")
            return False

# Global singleton
chrome_profile_manager = ChromeProfileManager()

