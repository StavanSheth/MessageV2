import os
import re
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
        if not os.path.exists(self.file_path):
            return False, "File does not exist on disk"
        try:
            wb = openpyxl.load_workbook(self.file_path, read_only=True)
            wb.close()
            return True, "File accessible"
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
            clean_user = val.lstrip("@").strip()
            if clean_user and re.match(r"^[a-zA-Z0-9_\.]+$", clean_user):
                username = clean_user
                url = f"https://www.instagram.com/{username}/"
            else:
                username = ""
                url = ""
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
            # Check if this row looks like header: has instagram/ig or (name/client and multiple cols)
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

        # Determine column indexes
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

            # Skip empty rows
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

    async def atomic_write_back(self, updates: Dict[str, Any]) -> Tuple[bool, str]:
        if self.workbook:
            try:
                self.workbook.close()
            except Exception:
                pass
            self.workbook = None

        try:
            wb = openpyxl.load_workbook(self.file_path)
            ws = wb.active
            headers = [cell.value for cell in ws[1]]
            status_col = None
            for idx, h in enumerate(headers, start=1):
                if h and str(h).strip().lower() in ["outreach status", "status"]:
                    status_col = idx
                    break
            if not status_col:
                status_col = len(headers) + 1
                ws.cell(row=1, column=status_col, value="Outreach Status")

            for key, data in updates.items():
                status_val = data.get("status", "")
                if key.startswith("row_"):
                    try:
                        row_num = int(key.split("_")[1])
                        ws.cell(row=row_num, column=status_col, value=status_val)
                    except Exception:
                        pass
                else:
                    for r_idx in range(2, ws.max_row + 1):
                        row_vals = [str(ws.cell(row=r_idx, column=c).value or "").lower() for c in range(1, 4)]
                        if any(key.lower() in rv for rv in row_vals):
                            ws.cell(row=r_idx, column=status_col, value=status_val)
                            break

            tmp_path = f"{self.file_path}.tmp"
            wb.save(tmp_path)
            wb.close()
            os.replace(tmp_path, self.file_path)
            return True, "Write-back successful"
        except Exception as e:
            return False, str(e)

    async def update_record(self, record_id: str, data: Dict[str, Any]) -> bool:
        if self.workbook:
            try:
                self.workbook.close()
            except Exception:
                pass
            self.workbook = None

        try:
            wb = openpyxl.load_workbook(self.file_path)
            ws = wb.active
            headers = [cell.value for cell in ws[1]]
            status_col = None
            for idx, h in enumerate(headers, start=1):
                if h and str(h).strip().lower() in ["outreach status", "status"]:
                    status_col = idx
                    break
            if not status_col:
                status_col = len(headers) + 1
                ws.cell(row=1, column=status_col, value="Outreach Status")

            status_val = data.get("status", "")
            target_row = None

            if str(record_id).startswith("row_"):
                try:
                    target_row = int(str(record_id).split("_")[1])
                except Exception:
                    pass
            else:
                clean_rec = str(record_id).lower().lstrip("@")
                for r_idx in range(2, ws.max_row + 1):
                    row_vals = [str(ws.cell(row=r_idx, column=c).value or "").lower() for c in range(1, 5)]
                    if any(clean_rec == rv or clean_rec in rv for rv in row_vals):
                        target_row = r_idx
                        break

            if target_row and target_row <= ws.max_row:
                ws.cell(row=target_row, column=status_col, value=status_val)
                wb.save(self.file_path)
                wb.close()
                return True

            wb.close()
            return False
        except Exception:
            return False

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
            self.workbook.close()
            self.workbook = None
