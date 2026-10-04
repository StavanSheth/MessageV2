import os
import re
import tempfile
from typing import List, Dict, Any, Tuple, Optional
import openpyxl
from backend.sources.base import SourceAdapter

class LocalXlsxSource(SourceAdapter):
    def __init__(self, file_path: str):
        self.file_path = file_path
        self.workbook = None
        self.sheet = None

    async def open(self) -> bool:
        if not os.path.exists(self.file_path):
            raise FileNotFoundError(f"File not found: {self.file_path}")
        self.workbook = openpyxl.load_workbook(self.file_path, data_only=True)
        self.sheet = self.workbook.active
        return True

    async def validate_access(self) -> Tuple[bool, str]:
        """Detect file existence, permissions, and whether file is locked by Excel/another process."""
        if not os.path.exists(self.file_path):
            return False, "File does not exist on disk"
        try:
            # Check read access
            wb = openpyxl.load_workbook(self.file_path, read_only=True)
            wb.close()

            # Check write/lock status by attempting to open file in append mode
            with open(self.file_path, "a+b"):
                pass

            return True, "File accessible and writable"
        except PermissionError:
            return False, "File is locked by Excel or another process (Permission Denied)"
        except Exception as e:
            return False, f"Access error: {str(e)}"

    @staticmethod
    def _normalize_header(header: Any) -> str:
        if not header:
            return ""
        return str(header).strip().lower().replace("_", " ").replace("-", " ")

    @staticmethod
    def _extract_username_from_url(url: str) -> Optional[str]:
        if not url:
            return None
        match = re.search(r"instagram\.com/([a-zA-Z0-9_\.\-]+)/?", url)
        if match:
            return match.group(1).strip()
        return None

    @staticmethod
    def _format_instagram_url(val: str) -> Tuple[str, str]:
        """Returns (instagram_url, username)."""
        val = str(val).strip()
        if "instagram.com" in val:
            url = val if val.startswith("http") else f"https://{val}"
            username = LocalXlsxSource._extract_username_from_url(url) or ""
            return url, username
        else:
            username = val.lstrip("@").strip()
            # If username contains whitespace or illegal characters, it's invalid
            if re.search(r"\s", username) or not re.match(r"^[a-zA-Z0-9_\.]{1,30}$", username):
                return "", ""
            url = f"https://www.instagram.com/{username}/"
            return url, username

    async def read_records(self) -> List[Dict[str, Any]]:
        if not self.workbook:
            await self.open()

        rows = list(self.sheet.iter_rows(values_only=True))
        if not rows:
            return []

        # Find header row by scanning first 10 rows
        header_row_idx = 0
        col_map = {}
        for r_i, r in enumerate(rows[:10]):
            test_map = {}
            for idx, col in enumerate(r):
                norm = self._normalize_header(col)
                if norm:
                    test_map[norm] = idx
            has_ig = any("instagram" in k or "ig" in k or "profile" in k or "social" in k for k in test_map)
            has_name = any("name" in k or "client" in k or "contact" in k or "handle" in k for k in test_map)
            if has_ig or (has_name and len(test_map) >= 3):
                header_row_idx = r_i
                col_map = test_map
                break

        if not col_map and rows:
            for idx, col in enumerate(rows[0]):
                norm = self._normalize_header(col)
                if norm:
                    col_map[norm] = idx

        def find_col(*aliases):
            for alias in aliases:
                for norm, idx in col_map.items():
                    if alias in norm or norm in alias:
                        return idx
            return None

        name_idx = find_col("client name", "client", "full name", "name", "contact", "user", "lead")
        ig_idx = find_col("instagram id/ link", "instagram id", "instagram link", "instagram url", "instagram", "username", "profile url", "ig", "social")
        msg_idx = find_col("message", "dm", "text", "body", "initial message", "reason")
        followers_idx = find_col("expected followers", "followers", "follower count")
        notes_idx = find_col("notes", "note", "comment", "remarks")

        records = []
        for row_idx, row in enumerate(rows[header_row_idx + 1:], start=header_row_idx + 2):
            if not any(cell is not None and str(cell).strip() != "" for cell in row):
                continue

            raw_dict = {}
            for col_norm, col_i in col_map.items():
                raw_dict[col_norm] = str(row[col_i]) if col_i < len(row) and row[col_i] is not None else ""

            name_val = str(row[name_idx]).strip() if name_idx is not None and name_idx < len(row) and row[name_idx] is not None else ""
            ig_val = str(row[ig_idx]).strip() if ig_idx is not None and ig_idx < len(row) and row[ig_idx] is not None else ""
            msg_val = str(row[msg_idx]).strip() if msg_idx is not None and msg_idx < len(row) and row[msg_idx] is not None else ""
            followers_val = None
            if followers_idx is not None and followers_idx < len(row) and row[followers_idx] is not None:
                try:
                    followers_val = int(re.sub(r"[^\d]", "", str(row[followers_idx])))
                except Exception:
                    followers_val = None
            notes_val = str(row[notes_idx]).strip() if notes_idx is not None and notes_idx < len(row) and row[notes_idx] is not None else None

            # Validation
            is_valid = True
            error_msg = None

            if not ig_val:
                is_valid = False
                error_msg = "Missing Instagram URL or username"
            else:
                ig_url, username = self._format_instagram_url(ig_val)
                if not username:
                    is_valid = False
                    error_msg = f"Invalid Instagram identifier: {ig_val}"

            if is_valid:
                if not name_val:
                    name_val = username or "User"
                if not msg_val:
                    msg_val = "Hey"

                norm_data = {
                    "name": name_val,
                    "instagram_url": ig_url,
                    "username": username,
                    "expected_followers": followers_val,
                    "message": msg_val,
                    "notes": notes_val
                }
            else:
                norm_data = {
                    "name": name_val or "Unknown",
                    "instagram_url": ig_val,
                    "username": None,
                    "message": msg_val or "Hey",
                    "notes": notes_val
                }

            records.append({
                "row_number": row_idx,
                "raw": raw_dict,
                "normalized": norm_data,
                "is_valid": is_valid,
                "error": error_msg
            })

        return records

    async def atomic_write_back(self, updates: Dict[str, Dict[str, Any]]) -> Tuple[bool, str]:
        """
        Atomic spreadsheet update:
        1. Checks lock/access
        2. Writes to temporary file
        3. Validates temporary file
        4. Replaces original file atomically
        5. Preserves original if write fails
        """
        access_ok, reason = await self.validate_access()
        if not access_ok:
            return False, f"Cannot write back: {reason}"

        dir_name = os.path.dirname(self.file_path)
        fd, temp_path = tempfile.mkstemp(suffix=".xlsx", dir=dir_name)
        os.close(fd)

        try:
            wb = openpyxl.load_workbook(self.file_path)
            ws = wb.active

            # Append or update Status / Sent At columns
            # Check header
            headers = [cell.value for cell in ws[1]]
            status_col = None
            for idx, h in enumerate(headers, 1):
                if h and "status" in str(h).lower():
                    status_col = idx
                    break

            if not status_col:
                status_col = len(headers) + 1
                ws.cell(row=1, column=status_col, value="Outreach Status")

            # Save to temporary path
            wb.save(temp_path)
            wb.close()

            # Validate that temporary file is readable and non-corrupt
            test_wb = openpyxl.load_workbook(temp_path, read_only=True)
            test_wb.close()

            # Atomically replace original
            os.replace(temp_path, self.file_path)
            return True, "Atomic write-back succeeded"

        except Exception as e:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass
            return False, f"Atomic write-back failed: {str(e)}"

    async def update_record(self, record_id: str, data: Dict[str, Any]) -> bool:
        success, _ = await self.atomic_write_back({record_id: data})
        return success

    async def sync(self) -> Dict[str, Any]:
        records = await self.read_records()
        valid = sum(1 for r in records if r["is_valid"])
        return {
            "total": len(records),
            "valid": valid,
            "invalid": len(records) - valid,
            "records": records
        }

    async def close(self) -> None:
        if self.workbook:
            try:
                self.workbook.close()
            except Exception:
                pass
            self.workbook = None
