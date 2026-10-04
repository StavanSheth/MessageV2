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
            m1_status = task_msg.status if task_msg else "NOT_QUEUED"
            if m1 and m1.status == "SENT":
                m1_status = "SENT"
            m1_time = format_datetime((m1.confirmed_at if m1 else None) or (task_msg.completed_at if task_msg else None))
            m1_body = (m1.body if m1 else contact.message) or "Hey"

            # Follow Up 1 info
            fu1_status = task_fu1.status if task_fu1 else ("SCHEDULED" if m1_status in ("SENT", "COMPLETED") else "NOT_SCHEDULED")
            fu1_sched = format_datetime(task_fu1.scheduled_at if task_fu1 else None)
            fu1_sent = format_datetime(m_fu1.confirmed_at or task_fu1.completed_at if (task_fu1 and task_fu1.completed_at) else None)
            fu1_body = (m_fu1.body if m_fu1 else contact.followup_1_message) or "—"

            # Follow Up 2 info
            fu2_status = task_fu2.status if task_fu2 else ("SCHEDULED" if fu1_status in ("SENT", "COMPLETED") else "NOT_SCHEDULED")
            fu2_sched = format_datetime(task_fu2.scheduled_at if task_fu2 else None)
            fu2_sent = format_datetime(m_fu2.confirmed_at or task_fu2.completed_at if (task_fu2 and task_fu2.completed_at) else None)
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
                    if val_str == "YES":
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
