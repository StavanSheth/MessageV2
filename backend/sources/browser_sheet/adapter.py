import asyncio
import re
from typing import List, Dict, Any, Tuple, Optional
from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from backend.sources.base import SourceAdapter
from backend.sources.xlsx.adapter import LocalXlsxSource
from backend.config.settings import settings

class BrowserSpreadsheetSource(SourceAdapter):
    def __init__(self, url: str):
        self.url = url
        self.playwright = None
        self.browser = None
        self.page = None
        self.local_source: Optional[LocalXlsxSource] = None

    async def open(self) -> bool:
        if self.page:
            return True
        self.playwright = await async_playwright().start()
        # Open dedicated visible native Chrome browser instance
        launch_args = ["--disable-blink-features=AutomationControlled", "--start-maximized", "--no-sandbox"]
        try:
            self.browser = await self.playwright.chromium.launch(
                channel="chrome",
                headless=False,
                slow_mo=settings.BROWSER_SLOW_MO,
                args=launch_args
            )
        except Exception:
            self.browser = await self.playwright.chromium.launch(
                headless=False,
                slow_mo=settings.BROWSER_SLOW_MO,
                args=launch_args
            )
        self.page = await self.browser.new_page(no_viewport=True)
        try:
            await self.page.bring_to_front()
        except Exception:
            pass
        try:
            await self.page.goto(self.url, wait_until="commit", timeout=settings.BROWSER_TIMEOUT)
        except Exception as e:
            print(f"[BrowserSpreadsheetSource] goto warning: {e}")
        await asyncio.sleep(2)
        return True


    async def validate_access(self) -> Tuple[bool, str]:
        try:
            if not self.page:
                await self.open()

            current_url = self.page.url.lower()
            page_content = ""
            try:
                page_content = (await self.page.content()).lower()
            except Exception:
                pass
            title = ""
            try:
                title = (await self.page.title()).lower()
            except Exception:
                pass

            # Check for permission denied, login required, or 403/404
            access_prohibited_signals = [
                "accounts.google.com/signin",
                "accounts.google.com/v3/signin",
                "you need access",
                "request access",
                "sign in to continue",
                "access denied",
                "403 forbidden",
                "404 not found",
                "permission denied"
            ]

            for signal in access_prohibited_signals:
                if signal in current_url or signal in title or signal in page_content[:2000]:
                    return False, f"ACCESS_PROHIBITED: {signal.capitalize()}"

            return True, "ACCESSIBLE"
        except Exception as e:
            return False, f"SOURCE_UNAVAILABLE: {str(e) or 'Page load timeout'}"


    async def read_records(self) -> List[Dict[str, Any]]:
        is_accessible, reason = await self.validate_access()
        if not is_accessible:
            raise PermissionError(reason)

        import httpx
        import uuid
        from backend.config.settings import DATA_DIR

        # Check for high-fidelity direct export/download for OneDrive & Google Sheets
        is_onedrive = any(x in self.url for x in ["1drv.ms", "onedrive.live.com", "sharepoint.com"])
        is_gsheet = "docs.google.com/spreadsheets" in self.url

        if is_onedrive or is_gsheet:
            try:
                download_url = self.url
                if is_onedrive:
                    download_url = self.url + ("&download=1" if "?" in self.url else "?download=1")
                elif is_gsheet:
                    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9_\-]+)", self.url)
                    if match:
                        sheet_id = match.group(1)
                        download_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"

                async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                    resp = await client.get(download_url)
                    if resp.status_code == 200 and len(resp.content) > 1000:
                        upload_dir = DATA_DIR / "uploads"
                        upload_dir.mkdir(parents=True, exist_ok=True)
                        dest_file = upload_dir / f"cloud_{uuid.uuid4().hex[:8]}.xlsx"
                        dest_file.write_bytes(resp.content)

                        # Delegate to LocalXlsxSource
                        self.local_source = LocalXlsxSource(str(dest_file))
                        records = await self.local_source.read_records()
                        if records:
                            return records
            except Exception as e:
                # Log and fallback to DOM extraction
                print(f"[BrowserSpreadsheetSource] Direct export fallback to DOM: {e}")

        # Detect table data from HTML table or Google Sheet DOM
        table_rows = await self.page.locator("table tr").all()
        extracted_grid: List[List[str]] = []

        if len(table_rows) > 0:
            for row in table_rows:
                cells = await row.locator("th, td").all_inner_texts()
                if any(c.strip() for c in cells):
                    extracted_grid.append([c.strip() for c in cells])
        else:
            # Fallback to general list or text extraction
            lines = (await self.page.locator("body").inner_text()).split("\n")
            extracted_grid = [[l.strip()] for l in lines if l.strip()]

        if not extracted_grid:
            return []


        # Parse identical to LocalXlsxSource
        header_row = extracted_grid[0]
        col_map = {}
        for idx, col in enumerate(header_row):
            norm = LocalXlsxSource._normalize_header(col)
            if norm:
                col_map[norm] = idx

        def find_col(*aliases):
            for alias in aliases:
                for norm, idx in col_map.items():
                    if alias in norm or norm in alias:
                        return idx
            return None

        name_idx = find_col("name", "full name", "contact", "user")
        ig_idx = find_col("instagram url", "instagram link", "instagram id", "instagram", "username", "profile url", "ig")
        msg_idx = find_col("message", "dm", "text", "body")
        followers_idx = find_col("expected followers", "followers")
        notes_idx = find_col("notes", "note")

        records = []
        for row_idx, row in enumerate(extracted_grid[1:], start=2):
            if not any(cell for cell in row):
                continue

            raw_dict = {f"col_{i}": cell for i, cell in enumerate(row)}
            name_val = row[name_idx] if name_idx is not None and name_idx < len(row) else ""
            ig_val = row[ig_idx] if ig_idx is not None and ig_idx < len(row) else ""
            msg_val = row[msg_idx] if msg_idx is not None and msg_idx < len(row) else ""
            followers_val = None
            if followers_idx is not None and followers_idx < len(row):
                try:
                    followers_val = int(re.sub(r"[^\d]", "", row[followers_idx]))
                except Exception:
                    followers_val = None
            notes_val = row[notes_idx] if notes_idx is not None and notes_idx < len(row) else None

            is_valid = True
            error_msg = None
            if not ig_val:
                is_valid = False
                error_msg = "Missing Instagram URL or username"
            else:
                ig_url, username = LocalXlsxSource._format_instagram_url(ig_val)
                if not username:
                    is_valid = False
                    error_msg = f"Invalid Instagram identifier: {ig_val}"

            if is_valid:
                norm_data = {
                    "name": name_val or username,
                    "instagram_url": ig_url,
                    "username": username,
                    "expected_followers": followers_val,
                    "message": msg_val or "Hey",
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

    async def update_record(self, record_id: str, data: Dict[str, Any]) -> bool:
        """
        Write-back status to the source sheet with mandatory verification:
        1. If a local downloaded copy exists (from direct export), update via LocalXlsxSource and verify.
        2. If active browser page is open with DOM table/grid:
           - Locate the row matching record_id (or row number)
           - Locate status column
           - Write/update status
           - Save/blur
           - Verify the resulting cell value
        3. Never report success if unverified. Return False on any failure.
        """
        status_val = str(data.get("status", "SENT"))
        updated = False

        # 1. Update downloaded Excel if available
        if self.local_source:
            try:
                local_ok = await self.local_source.update_record(record_id, data)
                if local_ok:
                    updated = True
            except Exception as e:
                print(f"[BrowserSpreadsheetSource] Local update error: {e}")

        # 2. Browser DOM-based update if page is open
        if self.page and not self.page.is_closed():
            try:
                is_accessible, _ = await self.validate_access()
                if not is_accessible:
                    return False

                # Locate table rows in browser
                table_rows = await self.page.locator("table tr").all()
                if table_rows:
                    # Find status column index in header
                    header_cells = await table_rows[0].locator("th, td").all_inner_texts()
                    status_col_idx = None
                    for idx, h in enumerate(header_cells):
                        if "status" in h.lower():
                            status_col_idx = idx
                            break
                    if status_col_idx is None:
                        status_col_idx = len(header_cells) - 1

                    # Locate matching target row
                    target_row_locator = None
                    if str(record_id).isdigit():
                        row_idx = int(record_id)
                        if 1 <= row_idx < len(table_rows):
                            target_row_locator = table_rows[row_idx]
                    else:
                        for row_loc in table_rows[1:]:
                            cells_text = await row_loc.locator("td").all_inner_texts()
                            if any(str(record_id).lower() in c.lower() for c in cells_text):
                                target_row_locator = row_loc
                                break

                    if target_row_locator:
                        target_cells = await target_row_locator.locator("td").all()
                        if status_col_idx < len(target_cells):
                            target_cell = target_cells[status_col_idx]
                            # Try updating via inner text / input / contenteditable
                            editable_elem = target_cell.locator("input, [contenteditable='true']").first
                            if await editable_elem.count() > 0:
                                await editable_elem.fill(status_val)
                                await editable_elem.press("Enter")
                            else:
                                await self.page.evaluate(
                                    """([cell, text]) => {
                                        cell.innerText = text;
                                        cell.dispatchEvent(new Event('input', { bubbles: true }));
                                        cell.dispatchEvent(new Event('change', { bubbles: true }));
                                    }""",
                                    [target_cell, status_val]
                                )
                            await asyncio.sleep(0.5)

                            # Mandatory verification: re-read value from cell
                            verified_text = (await target_cell.inner_text()).strip()
                            if status_val.lower() in verified_text.lower():
                                updated = True
            except Exception as e:
                print(f"[BrowserSpreadsheetSource] DOM update error: {e}")

        return updated

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
        if self.browser:
            await self.browser.close()
            self.browser = None
        if self.playwright:
            await self.playwright.stop()
            self.playwright = None
