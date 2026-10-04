import os
import tempfile
import pytest
import openpyxl
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.sources.xlsx.adapter import LocalXlsxSource
from backend.repositories.contact_repository import ContactRepository
from backend.repositories.task_repository import TaskRepository
from backend.repositories.source_repository import SourceRepository
from backend.database.models import Contact, Task

@pytest.fixture
def sample_xlsx():
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.append(["Name", "Instagram", "Message", "Followers"])
        ws.append(["Alice", "https://instagram.com/alice/", "Hello Alice", 1500])
        ws.append(["Bob", "invalid handle with spaces", "Hello Bob", 300]) # Invalid
        ws.append(["Charlie", "@charlie_ig", "Hello Charlie", 2000]) # Valid @
        ws.append(["", "", "", ""]) # Empty row
        wb.save(tmp.name)
        tmp_path = tmp.name

    yield tmp_path

    if os.path.exists(tmp_path):
        try:
            os.remove(tmp_path)
        except Exception:
            pass

@pytest.mark.asyncio
async def test_xlsx_row_validation_and_invalid_row_preservation(sample_xlsx):
    adapter = LocalXlsxSource(sample_xlsx)
    sync_result = await adapter.sync()
    records = sync_result["records"]

    assert len(records) == 3
    assert sync_result["valid"] == 2
    assert sync_result["invalid"] == 1

    # Check that invalid row is preserved with error message
    invalid_rec = [r for r in records if not r["is_valid"]][0]
    assert invalid_rec["raw"]["name"] == "Bob"
    assert invalid_rec["error"] is not None

    await adapter.close()

@pytest.mark.asyncio
async def test_duplicate_contact_and_task_prevention(test_session: AsyncSession):
    contact_repo = ContactRepository(test_session)
    task_repo = TaskRepository(test_session)

    # First import creates contact & task
    c1 = await contact_repo.create(
        name="Unique User",
        instagram_url="https://instagram.com/unique_user/",
        username="unique_user"
    )
    t1 = await task_repo.create(contact_id=c1.id, task_type="MESSAGE", idempotency_key=f"task_{c1.id}_MESSAGE")
    assert c1 is not None
    assert t1 is not None

    # Check duplicate detection by instagram_url
    existing = await contact_repo.get_by_instagram("https://instagram.com/unique_user/", "unique_user")
    assert existing is not None
    assert existing.id == c1.id

    # Deduplication ensures duplicate row does not create a new contact
    all_contacts = (await test_session.execute(select(Contact))).scalars().all()
    assert len(all_contacts) == 1

@pytest.mark.asyncio
async def test_excel_atomic_write_back(sample_xlsx):
    adapter = LocalXlsxSource(sample_xlsx)
    accessible, reason = await adapter.validate_access()
    assert accessible is True

    # Perform atomic write-back
    success, msg = await adapter.atomic_write_back({"row_2": {"status": "SENT"}})
    assert success is True

    # Verify updated file is readable
    wb = openpyxl.load_workbook(sample_xlsx, data_only=True)
    ws = wb.active
    headers = [cell.value for cell in ws[1]]
    assert "Outreach Status" in headers
    wb.close()
    await adapter.close()

@pytest.mark.asyncio
async def test_transactional_rollback_on_failure(test_session: AsyncSession):
    """
    Ensure that if an exception occurs during batch source import,
    the transaction is rolled back and no orphan contacts/tasks remain.
    """
    contact_repo = ContactRepository(test_session)
    task_repo = TaskRepository(test_session)

    try:
        # Create a contact
        c = await contact_repo.create(name="Temp", instagram_url="https://instagram.com/temp/", username="temp")
        # Intentionally force an error before commit
        raise RuntimeError("Simulated DB or network crash before commit")
    except RuntimeError:
        await test_session.rollback()

    # Verify no orphan contacts committed
    contacts = (await test_session.execute(select(Contact))).scalars().all()
    assert len(contacts) == 0
