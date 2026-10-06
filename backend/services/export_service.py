from datetime import datetime, timezone
import io
import re
from typing import List, Dict, Any, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Contact, Task, Message, Source, OutreachHistory, Event

def format_datetime(dt: Optional[datetime]) -> str:
    """Format datetime into standard readable string: YYYY-MM-DD HH:MM:SS UTC."""
    if not dt:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M:%S UTC")


class ExportService:
    @staticmethod
    def _create_styles():
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        cell_font = Font(name="Calibri", size=10)
        
        green_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
        green_font = Font(name="Calibri", size=10, bold=True, color="15803D")
        
        blue_fill = PatternFill(start_color="E0F2FE", end_color="E0F2FE", fill_type="solid")
        blue_font = Font(name="Calibri", size=10, bold=True, color="0369A1")
        
        amber_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
        amber_font = Font(name="Calibri", size=10, bold=True, color="B45309")
        
        red_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
        red_font = Font(name="Calibri", size=10, bold=True, color="B91C1C")

        center_align = Alignment(horizontal="center", vertical="center")
        left_align = Alignment(horizontal="left", vertical="center")
        
        thin_border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="E2E8F0"),
            bottom=Side(style="thin", color="E2E8F0")
        )
        return {
            "header_font": header_font, "header_fill": header_fill, "cell_font": cell_font,
            "green_fill": green_fill, "green_font": green_font,
            "blue_fill": blue_fill, "blue_font": blue_font,
            "amber_fill": amber_fill, "amber_font": amber_font,
            "red_fill": red_fill, "red_font": red_font,
            "center_align": center_align, "left_align": left_align,
            "thin_border": thin_border
        }

    @classmethod
    def _style_worksheet(cls, ws, headers: List[str], rows: List[List[Any]], status_cols: List[int] = None):
        st = cls._create_styles()
        ws.views.sheetView[0].showGridLines = True
        ws.append(headers)
        
        for c_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=c_idx)
            cell.font = st["header_font"]
            cell.fill = st["header_fill"]
            cell.alignment = st["center_align"]
            cell.border = st["thin_border"]
        ws.row_dimensions[1].height = 26

        for r_idx, row in enumerate(rows, start=2):
            ws.append(row)
            ws.row_dimensions[r_idx].height = 20
            for c_idx in range(1, len(row) + 1):
                cell = ws.cell(row=r_idx, column=c_idx)
                cell.font = st["cell_font"]
                cell.border = st["thin_border"]
                cell.alignment = st["left_align"]

                if status_cols and c_idx in status_cols:
                    cell.alignment = st["center_align"]
                    val = str(cell.value or "").upper()
                    if any(s in val for s in ["SENT", "COMPLETED", "YES"]):
                        cell.fill = st["green_fill"]
                        cell.font = st["green_font"]
                    elif any(s in val for s in ["READY", "QUEUED", "RUNNING", "SCHEDULED"]):
                        cell.fill = st["blue_fill"]
                        cell.font = st["blue_font"]
                    elif any(s in val for s in ["RETRY", "WAIT", "AUTOMATED"]):
                        cell.fill = st["amber_fill"]
                        cell.font = st["amber_font"]
                    elif any(s in val for s in ["FAILED", "MANUAL", "CANCELLED", "SKIPPED", "RESTRICTED", "NO"]):
                        cell.fill = st["red_fill"]
                        cell.font = st["red_font"]

        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = min(max(max_len + 3, 11), 50)
        ws.freeze_panes = "A2"

    @classmethod
    def _extract_contact_row(cls, contact: Contact) -> List[Any]:
        t1 = next((t for t in contact.tasks if t.type == "MESSAGE"), None)
        tf1 = next((t for t in contact.tasks if t.type == "FOLLOW_UP_1"), None)
        tf2 = next((t for t in contact.tasks if t.type == "FOLLOW_UP_2"), None)
        m1 = t1.messages[0] if (t1 and t1.messages) else None
        mf1 = tf1.messages[0] if (tf1 and tf1.messages) else None
        mf2 = tf2.messages[0] if (tf2 and tf2.messages) else None

        # 1st Message info
        m1_st = "NOT_QUEUED"
        m1_time = "—"
        if t1:
            m1_st = t1.status
            if t1.status == "COMPLETED" or (m1 and m1.status == "SENT"):
                m1_st = "SENT"
                m1_time = format_datetime(m1.confirmed_at if m1 else t1.completed_at)

        # Follow Up 1 info
        fu1_st = "NOT_SCHEDULED"
        fu1_timing = "—"
        if tf1:
            fu1_st = tf1.status
            if tf1.status == "COMPLETED" or (mf1 and mf1.status == "SENT"):
                fu1_st = "SENT"
                fu1_timing = f"Sent: {format_datetime(mf1.confirmed_at if mf1 else tf1.completed_at)}"
            elif tf1.status == "READY":
                fu1_st = "SCHEDULED"
                fu1_timing = f"Due: {format_datetime(tf1.scheduled_at)}"
            else:
                fu1_timing = format_datetime(tf1.scheduled_at)

        # Follow Up 2 info
        fu2_st = "NOT_SCHEDULED"
        fu2_timing = "—"
        if tf2:
            fu2_st = tf2.status
            if tf2.status == "COMPLETED" or (mf2 and mf2.status == "SENT"):
                fu2_st = "SENT"
                fu2_timing = f"Sent: {format_datetime(mf2.confirmed_at if mf2 else tf2.completed_at)}"
            elif tf2.status == "READY":
                fu2_st = "SCHEDULED"
                fu2_timing = f"Due: {format_datetime(tf2.scheduled_at)}"
            else:
                fu2_timing = format_datetime(tf2.scheduled_at)

        return [
            contact.id,
            contact.name or "—",
            f"@{contact.username}" if contact.username else "—",
            contact.expected_followers or "—",
            m1_st,
            m1_time,
            (m1.body if m1 else contact.message) or "—",
            fu1_st,
            fu1_timing,
            (mf1.body if mf1 else contact.followup_1_message) or "—",
            fu2_st,
            fu2_timing,
            (mf2.body if mf2 else contact.followup_2_message) or "—",
            contact.replied_status or "UNKNOWN",
            contact.extracted_phone or "—",
            contact.extracted_email or "—",
            contact.notes or "—",
            format_datetime(contact.created_at)
        ]

    @classmethod
    def _get_task_condition_label(cls, task: Task) -> str:
        raw_cat = (getattr(task, 'error_category', None) or getattr(task, 'error_code', None) or '').upper()
        raw_msg = (task.manual_review_reason or getattr(task, 'error_message', None) or getattr(task, 'last_error', None) or '')
        status_str = (task.status or '').upper()
        contact = task.contact
        replied_status = (contact.replied_status if contact else '').upper()

        tag_match = re.match(r'^\[([A-Z0-9_]+)\]\s*(.*)', raw_msg, re.IGNORECASE)
        matched_tag = tag_match.group(1).upper() if tag_match else raw_cat
        clean_msg = (tag_match.group(2).strip() if tag_match else raw_msg).lower()

        if status_str == 'COMPLETED':
            if replied_status in ['YES', 'AUTOMATED_MESSAGE']:
                return "Delivered (Contact Replied)"
            return "Delivered Successfully"

        if status_str in ['READY', 'QUEUED']:
            return "Ready for Dispatch"

        if status_str == 'RUNNING':
            return "Dispatching Now"

        if status_str == 'PAUSED':
            return "Paused"

        # Specific attention conditions with human-readable names
        if 'AWAITING_APPROVAL' in matched_tag or status_str == 'AWAITING_APPROVAL' or 'awaiting approval' in clean_msg:
            return "Approval Required"

        if (
            'PAGE_NOT_FOUND' in matched_tag
            or 'PROFILE_NOT_FOUND' in matched_tag
            or '404' in clean_msg
            or 'page not found' in clean_msg
            or 'profile not found' in clean_msg
            or "isn't available" in clean_msg
            or "is not available" in clean_msg
            or "link you followed may be broken" in clean_msg
            or "page may have been removed" in clean_msg
        ):
            return "Page Not Found (404)"

        if 'DM_RESTRICTED' in matched_tag or replied_status == 'DM_RESTRICTED' or 'does not accept' in clean_msg or 'no message button' in clean_msg:
            return "DMs Restricted / Closed"

        if 'DM_NOT_AVAILABLE' in matched_tag or 'not available' in clean_msg:
            return "DM Message Button Unavailable"

        if 'EXTERNAL_MESSAGE_DETECTED' in matched_tag or 'external message' in clean_msg:
            return "External Message Detected"

        if 'REPLY_RECEIVED' in matched_tag or 'reply received' in clean_msg or replied_status in ['YES', 'AUTOMATED_MESSAGE']:
            return "Contact Already Replied"

        if 'EXISTING_HISTORY' in matched_tag or 'ALREADY_MESSAGED' in matched_tag or 'existing' in clean_msg or 'prior' in clean_msg:
            return "Prior Chat History Detected"

        if 'RATE_LIMITED' in matched_tag or 'rate limit' in clean_msg or 'action blocked' in clean_msg:
            return "Rate Limited / Cooldown"

        if 'PROFILE_MISMATCH' in matched_tag or 'mismatch' in clean_msg:
            return "Profile Identity Mismatch"

        if 'follow-up 1 was not completed' in clean_msg or 'out of order' in clean_msg:
            return "Previous Follow-Up Not Completed"

        if 'COMPOSER_UNAVAILABLE' in matched_tag or 'composer' in clean_msg:
            return "DM Composer Unavailable"

        if 'CHALLENGE_REQUIRED' in matched_tag or 'checkpoint' in clean_msg or 'challenge' in clean_msg:
            return "Security Checkpoint"

        if 'AUTH' in matched_tag or 'login' in clean_msg:
            return "Authentication / Login Required"

        if status_str == 'CANCELLED':
            return "Cancelled"

        if status_str == 'RETRY_WAIT':
            return "Waiting for Retry"

        if status_str == 'INTERRUPTED':
            return "Interrupted"

        if status_str == 'RECONCILING':
            return "Reconciling State"

        if status_str == 'SKIPPED':
            return "Skipped"

        if status_str == 'MANUAL_REVIEW':
            return "Manual Review Required"

        return status_str.replace('_', ' ').title()

    @classmethod
    def _extract_task_row(cls, task: Task) -> List[Any]:
        cnt = task.contact
        err_or_reason = task.manual_review_reason or getattr(task, 'error_message', None) or "—"
        cond_label = cls._get_task_condition_label(task)
        msg_body = "—"
        if cnt:
            if task.type == "FOLLOW_UP_1" and cnt.followup_1_message:
                msg_body = cnt.followup_1_message
            elif task.type == "FOLLOW_UP_2" and cnt.followup_2_message:
                msg_body = cnt.followup_2_message
            elif cnt.message:
                msg_body = cnt.message
        return [
            task.id,
            cnt.name if cnt else "—",
            f"@{cnt.username}" if (cnt and cnt.username) else "—",
            task.type,
            task.status,
            cond_label,
            f"P{task.priority}",
            msg_body,
            format_datetime(task.scheduled_at),
            format_datetime(task.completed_at),
            task.attempt_count or 0,
            err_or_reason,
            format_datetime(task.created_at)
        ]

    @classmethod
    async def generate_universal_excel(cls, session: AsyncSession) -> io.BytesIO:
        """
        Generates a comprehensive, clean 5-Table universal Excel workbook containing:
        1. Contacts Directory
        2. Execution Dispatch Queue
        3. Data Sources
        4. Outreach History
        5. Audit Event Logs
        Ensures fresh data by expiring the SQLAlchemy session cache.
        """
        session.expire_all()
        wb = openpyxl.Workbook()

        # ── Sheet 1: Contacts Directory ──
        ws1 = wb.active
        ws1.title = "1. Contacts Directory"
        c_res = await session.execute(
            select(Contact)
            .options(selectinload(Contact.tasks).selectinload(Task.messages))
            .order_by(Contact.created_at.desc())
        )
        contacts = list(c_res.scalars().all())
        c_headers = [
            "Contact ID", "Name", "Instagram Handle", "Followers",
            "1st Msg Status", "1st Msg Sent At", "1st Msg Copy",
            "FU1 Status", "FU1 Scheduled / Sent At", "FU1 Copy",
            "FU2 Status", "FU2 Scheduled / Sent At", "FU2 Copy",
            "Replied Status", "Extracted Phone", "Extracted Email", "Notes", "Created At"
        ]
        c_rows = [cls._extract_contact_row(c) for c in contacts]
        cls._style_worksheet(ws1, c_headers, c_rows, status_cols=[5, 8, 11, 14])

        # ── Sheet 2: Dispatch Queue ──
        ws2 = wb.create_sheet(title="2. Dispatch Queue")
        t_res = await session.execute(
            select(Task)
            .options(selectinload(Task.contact))
            .order_by(Task.scheduled_at.asc())
        )
        tasks = list(t_res.scalars().all())
        t_headers = [
            "Task ID", "Contact Name", "Instagram Handle", "Stage / Type",
            "Status", "Condition / Category", "Priority", "Queued Message",
            "Scheduled At", "Completed At", "Attempts",
            "Review Reason / Error", "Created At"
        ]
        t_rows = [cls._extract_task_row(t) for t in tasks]
        cls._style_worksheet(ws2, t_headers, t_rows, status_cols=[5, 6])

        # ── Sheet 3: Sources ──
        ws3 = wb.create_sheet(title="3. Ingested Sources")
        s_res = await session.execute(select(Source).order_by(Source.created_at.desc()))
        sources = list(s_res.scalars().all())
        s_headers = [
            "Source ID", "Name", "Type", "Status", "Total Rows",
            "Valid Rows", "Invalid Rows", "Imported Rows", "File / URL", "Created At"
        ]
        s_rows = [
            [
                s.id, s.name, s.type, s.status, s.total_rows,
                s.valid_rows, s.invalid_rows, s.imported_rows,
                s.file_path_or_url or "—", format_datetime(s.created_at)
            ]
            for s in sources
        ]
        cls._style_worksheet(ws3, s_headers, s_rows, status_cols=[4])

        # ── Sheet 4: Outreach History ──
        ws4 = wb.create_sheet(title="4. Outreach History")
        h_res = await session.execute(select(OutreachHistory).order_by(OutreachHistory.created_at.desc()))
        hist = list(h_res.scalars().all())
        h_headers = ["History ID", "Action", "Contact Name", "Instagram Handle", "Details", "Timestamp"]
        h_rows = [
            [
                h.id, h.action, h.contact_name or "—",
                f"@{h.username}" if h.username else "—",
                h.details or "—", format_datetime(h.created_at)
            ]
            for h in hist
        ]
        cls._style_worksheet(ws4, h_headers, h_rows, status_cols=[2])

        # ── Sheet 5: Audit Event Logs ──
        ws5 = wb.create_sheet(title="5. Audit Event Logs")
        e_res = await session.execute(select(Event).order_by(Event.timestamp.desc()).limit(1000))
        events = list(e_res.scalars().all())
        e_headers = ["Event ID", "Timestamp", "Level", "Category", "Event Code", "Entity ID", "Payload"]
        e_rows = [
            [
                e.id, format_datetime(e.timestamp), e.level, e.category,
                e.event_code, e.entity_id or "—", str(e.payload_json or "")
            ]
            for e in events
        ]
        cls._style_worksheet(ws5, e_headers, e_rows, status_cols=[3, 5])

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

    @classmethod
    async def generate_queue_excel(cls, session: AsyncSession) -> io.BytesIO:
        """
        Generates a categorized Queue workbook (.xlsx) with 4 sheets:
        1. Upcoming Queue (READY, RUNNING, QUEUED, RETRY_WAIT)
        2. Done Already (COMPLETED)
        3. Needs Attention (MANUAL_REVIEW, FAILED, CANCELLED)
        4. All Tasks
        """
        session.expire_all()
        wb = openpyxl.Workbook()

        stmt = (
            select(Task)
            .options(selectinload(Task.contact))
            .order_by(Task.scheduled_at.asc())
        )
        tasks = list((await session.execute(stmt)).scalars().all())

        t_headers = [
            "Task ID", "Contact Name", "Instagram Handle", "Stage / Type",
            "Status", "Condition / Category", "Priority", "Queued Message",
            "Scheduled Time", "Completed Time", "Attempts",
            "Review Reason / Error", "Created At"
        ]

        upcoming = [t for t in tasks if t.status in ["READY", "RUNNING", "QUEUED", "PAUSED"]]
        done = [t for t in tasks if t.status == "COMPLETED"]
        issues = [
            t for t in tasks if t.status in [
                "MANUAL_REVIEW", "RETRY_WAIT", "AWAITING_APPROVAL",
                "RECONCILING", "FAILED", "INTERRUPTED", "SKIPPED", "CANCELLED"
            ] or (t.contact and t.contact.replied_status in ["YES", "AUTOMATED_MESSAGE", "DM_RESTRICTED"])
        ]

        # Sheet 1: Upcoming Queue
        ws1 = wb.active
        ws1.title = "Upcoming Queue"
        cls._style_worksheet(ws1, t_headers, [cls._extract_task_row(t) for t in upcoming], status_cols=[5, 6])

        # Sheet 2: Done Already
        ws2 = wb.create_sheet(title="Done Already")
        cls._style_worksheet(ws2, t_headers, [cls._extract_task_row(t) for t in done], status_cols=[5, 6])

        # Sheet 3: Action Needed / Needs Attention
        ws3 = wb.create_sheet(title="Action Needed")
        cls._style_worksheet(ws3, t_headers, [cls._extract_task_row(t) for t in issues], status_cols=[5, 6])

        # Sheet 4: All Tasks
        ws4 = wb.create_sheet(title="All Tasks")
        cls._style_worksheet(ws4, t_headers, [cls._extract_task_row(t) for t in tasks], status_cols=[5, 6])

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

    @classmethod
    async def generate_contacts_excel(cls, session: AsyncSession) -> io.BytesIO:
        """
        Generates a categorized Contacts workbook (.xlsx) with 4 sheets:
        1. All Contacts (Complete sequence tracking)
        2. Replied Leads (Inbound replies & extracted phone/email)
        3. Active Outreach (1st message sent, awaiting follow-ups)
        4. Needs Review (Flagged for review, DM restricted, external message detected)
        """
        session.expire_all()
        wb = openpyxl.Workbook()

        stmt = (
            select(Contact)
            .options(selectinload(Contact.tasks).selectinload(Task.messages))
            .order_by(Contact.name.asc())
        )
        contacts = list((await session.execute(stmt)).scalars().all())

        c_headers = [
            "Contact ID", "Name", "Instagram Handle", "Followers",
            "1st Msg Status", "1st Msg Sent At", "1st Msg Copy",
            "FU1 Status", "FU1 Scheduled / Sent At", "FU1 Copy",
            "FU2 Status", "FU2 Scheduled / Sent At", "FU2 Copy",
            "Replied Status", "Extracted Phone", "Extracted Email", "Notes", "Created At"
        ]

        def is_replied(c: Contact) -> bool:
            return bool(c.replied_status in ["YES", "AUTOMATED_MESSAGE"] or getattr(c, 'auto_reply_message', None))

        def is_active_outreach(c: Contact) -> bool:
            t1 = next((t for t in c.tasks if t.type == "MESSAGE"), None)
            m1_sent = t1 and t1.status == "COMPLETED"
            return m1_sent and not is_replied(c)

        def needs_review(c: Contact) -> bool:
            if c.replied_status == "DM_RESTRICTED":
                return True
            for t in c.tasks:
                if t.status in ["MANUAL_REVIEW", "FAILED"]:
                    return True
            return False

        replied_list = [c for c in contacts if is_replied(c)]
        active_list = [c for c in contacts if is_active_outreach(c)]
        review_list = [c for c in contacts if needs_review(c)]

        # Sheet 1: All Contacts
        ws1 = wb.active
        ws1.title = "All Contacts"
        cls._style_worksheet(ws1, c_headers, [cls._extract_contact_row(c) for c in contacts], status_cols=[5, 8, 11, 14])

        # Sheet 2: Replied Leads
        ws2 = wb.create_sheet(title="Replied Leads")
        cls._style_worksheet(ws2, c_headers, [cls._extract_contact_row(c) for c in replied_list], status_cols=[5, 8, 11, 14])

        # Sheet 3: Active Outreach
        ws3 = wb.create_sheet(title="Active Outreach")
        cls._style_worksheet(ws3, c_headers, [cls._extract_contact_row(c) for c in active_list], status_cols=[5, 8, 11, 14])

        # Sheet 4: Needs Review
        ws4 = wb.create_sheet(title="Needs Review")
        cls._style_worksheet(ws4, c_headers, [cls._extract_contact_row(c) for c in review_list], status_cols=[5, 8, 11, 14])

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

    # Backwards-compatibility alias
    @classmethod
    async def generate_outreach_excel(cls, session: AsyncSession) -> io.BytesIO:
        return await cls.generate_contacts_excel(session)
