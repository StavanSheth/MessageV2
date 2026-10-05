from datetime import datetime, timezone
import io
from typing import List, Dict, Any, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database.models import Contact, Task, Message

def format_datetime(dt: Optional[datetime]) -> str:
    """Format datetime into standard readable string: YYYY-MM-DD HH:MM:SS UTC."""
    if not dt:
        return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y-%m-%d %H:%M:%S UTC")

class ExportService:
    @staticmethod
    async def generate_outreach_excel(session: AsyncSession) -> io.BytesIO:
        """
        Generates a comprehensive, styled Excel spreadsheet (.xlsx) tracking:
        - 1st Message (Status, Sent Date/Time, Content)
        - Follow Up 1 (Status, Scheduled Date/Time, Sent Date/Time, Content)
        - Follow Up 2 (Status, Scheduled Date/Time, Sent Date/Time, Content)
        - Reply status and notes
        """
        # Fetch all contacts with their tasks and messages
        stmt = (
            select(Contact)
            .options(
                selectinload(Contact.tasks).selectinload(Task.messages)
            )
            .order_by(Contact.name.asc())
        )
        res = await session.execute(stmt)
        contacts = list(res.scalars().all())

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Outreach Tracking"
        ws.views.sheetView[0].showGridLines = True

        # Define Styles
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        
        green_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")
        green_font = Font(name="Calibri", size=10, bold=True, color="15803D")
        
        blue_fill = PatternFill(start_color="E0F2FE", end_color="E0F2FE", fill_type="solid")
        blue_font = Font(name="Calibri", size=10, bold=True, color="0369A1")
        
        amber_fill = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")
        amber_font = Font(name="Calibri", size=10, bold=True, color="B45309")
        
        red_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")
        red_font = Font(name="Calibri", size=10, bold=True, color="B91C1C")
        
        cell_font = Font(name="Calibri", size=10)
        center_align = Alignment(horizontal="center", vertical="center")
        left_align = Alignment(horizontal="left", vertical="center")
        
        thin_border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="E2E8F0"),
            bottom=Side(style="thin", color="E2E8F0")
        )

        headers = [
            "Contact ID",
            "Contact Name",
            "Instagram Handle",
            "Instagram URL",
            "Expected Followers",
            "1st Message Status",
            "1st Message Date & Time",
            "1st Message Content",
            "Follow Up 1 Status",
            "Follow Up 1 Scheduled At",
            "Follow Up 1 Sent At",
            "Follow Up 1 Content",
            "Follow Up 2 Status",
            "Follow Up 2 Scheduled At",
            "Follow Up 2 Sent At",
            "Follow Up 2 Content",
            "Replied Status",
            "Notes"
        ]

        # Write header row
        ws.append(headers)
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_idx)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = center_align
            cell.border = thin_border
        ws.row_dimensions[1].height = 28

        # Populate rows
        for row_idx, contact in enumerate(contacts, start=2):
            # Parse tasks
            task_msg = next((t for t in contact.tasks if t.type == "MESSAGE"), None)
            task_fu1 = next((t for t in contact.tasks if t.type == "FOLLOW_UP_1"), None)
            task_fu2 = next((t for t in contact.tasks if t.type == "FOLLOW_UP_2"), None)

            # Messages details
            m1 = task_msg.messages[0] if (task_msg and task_msg.messages) else None
            m_fu1 = task_fu1.messages[0] if (task_fu1 and task_fu1.messages) else None
            m_fu2 = task_fu2.messages[0] if (task_fu2 and task_fu2.messages) else None

            # 1st Message info
            m1_status = "NOT_QUEUED"
            m1_time = "—"
            if task_msg:
                m1_status = task_msg.status
                if task_msg.status == "COMPLETED" or (m1 and m1.status == "SENT"):
                    m1_status = "SENT"
                    m1_time = format_datetime(m1.confirmed_at if m1 else task_msg.completed_at)
            m1_body = (m1.body if m1 else contact.message) or "Hey"

            # Follow Up 1 info
            fu1_status = "NOT_SCHEDULED"
            fu1_sched = "—"
            fu1_sent = "—"
            if task_fu1:
                fu1_status = task_fu1.status
                fu1_sched = format_datetime(task_fu1.scheduled_at)
                if task_fu1.status == "COMPLETED" or (m_fu1 and m_fu1.status == "SENT"):
                    fu1_status = "SENT"
                    fu1_sent = format_datetime(m_fu1.confirmed_at if m_fu1 else task_fu1.completed_at)
                elif task_fu1.status == "READY":
                    fu1_status = "SCHEDULED"
            fu1_body = (m_fu1.body if m_fu1 else contact.followup_1_message) or "—"

            # Follow Up 2 info
            fu2_status = "NOT_SCHEDULED"
            fu2_sched = "—"
            fu2_sent = "—"
            if task_fu2:
                fu2_status = task_fu2.status
                fu2_sched = format_datetime(task_fu2.scheduled_at)
                if task_fu2.status == "COMPLETED" or (m_fu2 and m_fu2.status == "SENT"):
                    fu2_status = "SENT"
                    fu2_sent = format_datetime(m_fu2.confirmed_at if m_fu2 else task_fu2.completed_at)
                elif task_fu2.status == "READY":
                    fu2_status = "SCHEDULED"
            fu2_body = (m_fu2.body if m_fu2 else contact.followup_2_message) or "—"

            row_data = [
                contact.id,
                contact.name or "—",
                f"@{contact.username}" if contact.username else "—",
                contact.instagram_url,
                contact.expected_followers or "—",
                m1_status,
                m1_time,
                m1_body,
                fu1_status,
                fu1_sched,
                fu1_sent,
                fu1_body,
                fu2_status,
                fu2_sched,
                fu2_sent,
                fu2_body,
                contact.replied_status or "UNKNOWN",
                contact.notes or "—"
            ]

            ws.append(row_data)
            ws.row_dimensions[row_idx].height = 22

            # Style each cell in row
            for col_idx in range(1, len(row_data) + 1):
                cell = ws.cell(row=row_idx, column=col_idx)
                cell.font = cell_font
                cell.border = thin_border
                cell.alignment = left_align

                val_str = str(cell.value or "")

                # Status Highlights
                if col_idx in (6, 9, 13):  # Status columns
                    cell.alignment = center_align
                    if val_str in ("SENT", "COMPLETED"):
                        cell.fill = green_fill
                        cell.font = green_font
                    elif val_str in ("SCHEDULED", "READY"):
                        cell.fill = blue_fill
                        cell.font = blue_font
                    elif val_str in ("FAILED", "SKIPPED", "CANCELLED"):
                        cell.fill = red_fill
                        cell.font = red_font
                    else:
                        cell.fill = amber_fill
                        cell.font = amber_font

                if col_idx == 17:  # Replied column
                    cell.alignment = center_align
                    if val_str in ("YES", "AUTOMATED_MESSAGE"):
                        cell.fill = green_fill
                        cell.font = green_font
                    elif val_str == "NO":
                        cell.fill = red_fill
                        cell.font = red_font

        # Auto-adjust column widths
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = min(max(max_len + 4, 12), 45)

        # Freeze top header row
        ws.freeze_panes = "A2"

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

    @staticmethod
    async def generate_universal_excel(session: AsyncSession) -> io.BytesIO:
        """
        Generates a comprehensive 5-Table universal Excel workbook containing:
        1. Contacts Directory
        2. Execution Dispatch Queue
        3. Data Sources
        4. Outreach History & Runs
        5. Audit Event Logs
        """
        from backend.database.models import Source, OutreachHistory, Event

        wb = openpyxl.Workbook()
        
        # Styles
        header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        cell_font = Font(name="Calibri", size=10)
        thin_border = Border(
            left=Side(style="thin", color="E2E8F0"),
            right=Side(style="thin", color="E2E8F0"),
            top=Side(style="thin", color="E2E8F0"),
            bottom=Side(style="thin", color="E2E8F0")
        )
        center_align = Alignment(horizontal="center", vertical="center")
        left_align = Alignment(horizontal="left", vertical="center")

        def style_sheet(ws, headers, rows):
            ws.views.sheetView[0].showGridLines = True
            ws.append(headers)
            for c_idx in range(1, len(headers) + 1):
                cell = ws.cell(row=1, column=c_idx)
                cell.font = header_font
                cell.fill = header_fill
                cell.alignment = center_align
                cell.border = thin_border
            ws.row_dimensions[1].height = 26

            for r_idx, row in enumerate(rows, start=2):
                ws.append(row)
                ws.row_dimensions[r_idx].height = 20
                for c_idx in range(1, len(row) + 1):
                    cell = ws.cell(row=r_idx, column=c_idx)
                    cell.font = cell_font
                    cell.border = thin_border
                    cell.alignment = left_align

            for col in ws.columns:
                max_len = max(len(str(cell.value or "")) for cell in col)
                col_letter = get_column_letter(col[0].column)
                ws.column_dimensions[col_letter].width = min(max(max_len + 3, 11), 50)
            ws.freeze_panes = "A2"

        # Sheet 1: Contacts
        ws1 = wb.active
        ws1.title = "1. Contacts Directory"
        c_res = await session.execute(
            select(Contact)
            .options(selectinload(Contact.tasks).selectinload(Task.messages))
            .order_by(Contact.created_at.desc())
        )
        all_contacts = list(c_res.scalars().all())
        c_headers = [
            "Contact ID", "Name", "Username", "Instagram URL", "Followers",
            "1st Msg Status", "1st Msg Sent At", "1st Msg Copy",
            "FU1 Status", "FU1 Due", "FU1 Sent At", "FU1 Copy",
            "FU2 Status", "FU2 Due", "FU2 Sent At", "FU2 Copy",
            "Replied Status", "Extracted Phone", "Extracted Email", "Last Run ID", "Notes", "Created At"
        ]
        c_rows = []
        for c in all_contacts:
            t1 = next((t for t in c.tasks if t.type == "MESSAGE"), None)
            tf1 = next((t for t in c.tasks if t.type == "FOLLOW_UP_1"), None)
            tf2 = next((t for t in c.tasks if t.type == "FOLLOW_UP_2"), None)
            m1 = t1.messages[0] if (t1 and t1.messages) else None
            mf1 = tf1.messages[0] if (tf1 and tf1.messages) else None
            mf2 = tf2.messages[0] if (tf2 and tf2.messages) else None

            # 1st Message info
            m1_st = "NOT_QUEUED"
            m1_st_time = "—"
            if t1:
                m1_st = t1.status
                if t1.status == "COMPLETED" or (m1 and m1.status == "SENT"):
                    m1_st = "SENT"
                    m1_st_time = format_datetime(m1.confirmed_at if m1 else t1.completed_at)

            # Follow Up 1 info
            fu1_st = "NOT_SCHEDULED"
            fu1_st_due = "—"
            fu1_st_sent = "—"
            if tf1:
                fu1_st = tf1.status
                fu1_st_due = format_datetime(tf1.scheduled_at)
                if tf1.status == "COMPLETED" or (mf1 and mf1.status == "SENT"):
                    fu1_st = "SENT"
                    fu1_st_sent = format_datetime(mf1.confirmed_at if mf1 else tf1.completed_at)
                elif tf1.status == "READY":
                    fu1_st = "SCHEDULED"

            # Follow Up 2 info
            fu2_st = "NOT_SCHEDULED"
            fu2_st_due = "—"
            fu2_st_sent = "—"
            if tf2:
                fu2_st = tf2.status
                fu2_st_due = format_datetime(tf2.scheduled_at)
                if tf2.status == "COMPLETED" or (mf2 and mf2.status == "SENT"):
                    fu2_st = "SENT"
                    fu2_st_sent = format_datetime(mf2.confirmed_at if mf2 else tf2.completed_at)
                elif tf2.status == "READY":
                    fu2_st = "SCHEDULED"

            c_rows.append([
                c.id, c.name or "—", f"@{c.username}" if c.username else "—", c.instagram_url, c.expected_followers or "—",
                m1_st, m1_st_time, (m1.body if m1 else c.message) or "—",
                fu1_st, fu1_st_due, fu1_st_sent, (mf1.body if mf1 else c.followup_1_message) or "—",
                fu2_st, fu2_st_due, fu2_st_sent, (mf2.body if mf2 else c.followup_2_message) or "—",
                c.replied_status or "UNKNOWN",
                c.extracted_phone or "—",
                c.extracted_email or "—",
                c.last_run_id or "—",
                c.notes or "—",
                format_datetime(c.created_at)
            ])
        style_sheet(ws1, c_headers, c_rows)

        # Sheet 2: Tasks / Queue
        ws2 = wb.create_sheet(title="2. Dispatch Queue")
        t_res = await session.execute(
            select(Task)
            .options(selectinload(Task.contact))
            .order_by(Task.scheduled_at.asc())
        )
        all_tasks = list(t_res.scalars().all())
        t_headers = [
            "Task ID", "Contact ID", "Contact Name", "Username", "Stage / Type",
            "Status", "Priority", "Scheduled At", "Completed At", "Attempts", "Run ID", "Created At"
        ]
        t_rows = []
        for t in all_tasks:
            cnt = t.contact
            t_rows.append([
                t.id, t.contact_id, cnt.name if cnt else "—",
                f"@{cnt.username}" if (cnt and cnt.username) else "—",
                t.type, t.status, f"P{t.priority}",
                format_datetime(t.scheduled_at),
                format_datetime(t.completed_at),
                t.attempt_count or 0,
                t.run_id or "—",
                format_datetime(t.created_at)
            ])
        style_sheet(ws2, t_headers, t_rows)

        # Sheet 3: Sources
        ws3 = wb.create_sheet(title="3. Ingested Sources")
        s_res = await session.execute(select(Source).order_by(Source.created_at.desc()))
        all_sources = list(s_res.scalars().all())
        s_headers = [
            "Source ID", "Name", "Type", "Status", "Total Rows",
            "Valid Rows", "Invalid Rows", "Imported Rows", "File Path / URL", "Created At"
        ]
        s_rows = [
            [
                s.id, s.name, s.type, s.status, s.total_rows,
                s.valid_rows, s.invalid_rows, s.imported_rows,
                s.file_path_or_url, format_datetime(s.created_at)
            ]
            for s in all_sources
        ]
        style_sheet(ws3, s_headers, s_rows)

        # Sheet 4: Outreach History
        ws4 = wb.create_sheet(title="4. Outreach History")
        h_res = await session.execute(select(OutreachHistory).order_by(OutreachHistory.created_at.desc()))
        all_hist = list(h_res.scalars().all())
        h_headers = ["History ID", "Action", "Username", "Instagram URL", "Contact Name", "Run ID", "Details", "Timestamp"]
        h_rows = [
            [
                h.id, h.action, f"@{h.username}" if h.username else "—",
                h.instagram_url, h.contact_name or "—", h.run_id or "—",
                h.details or "—", format_datetime(h.created_at)
            ]
            for h in all_hist
        ]
        style_sheet(ws4, h_headers, h_rows)

        # Sheet 5: Audit Event Logs
        ws5 = wb.create_sheet(title="5. Audit Event Logs")
        e_res = await session.execute(select(Event).order_by(Event.timestamp.desc()).limit(1000))
        all_events = list(e_res.scalars().all())
        e_headers = ["Event ID", "Timestamp", "Level", "Category", "Event Code", "Entity ID", "Payload"]
        e_rows = [
            [
                e.id, format_datetime(e.timestamp), e.level, e.category,
                e.event_code, e.entity_id or "—", str(e.payload_json or "")
            ]
            for e in all_events
        ]
        style_sheet(ws5, e_headers, e_rows)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output

