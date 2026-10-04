import pytest
import openpyxl
from backend.sources.xlsx.adapter import LocalXlsxSource

def test_extract_username_variations():
    assert LocalXlsxSource._extract_username_from_url("https://www.instagram.com/john_doe/") == "john_doe"
    assert LocalXlsxSource._extract_username_from_url("https://instagram.com/jane.doe") == "jane.doe"
    
    url, user = LocalXlsxSource._format_instagram_url("@my_handle")
    assert user == "my_handle"
    assert url == "https://www.instagram.com/my_handle/"

    url, user = LocalXlsxSource._format_instagram_url("simple_user")
    assert user == "simple_user"
    assert url == "https://www.instagram.com/simple_user/"

def test_header_normalization():
    assert LocalXlsxSource._normalize_header("  IG_Profile  ") == "ig profile"
    assert LocalXlsxSource._normalize_header("Full-Name") == "full name"

@pytest.mark.asyncio
async def test_parse_in_memory_xlsx(tmp_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Contacts"
    ws.append(["Name", "Instagram URL", "Message"])
    ws.append(["Alice Smith", "https://instagram.com/alice_smith", "Hello Alice!"])
    ws.append(["Bob Jones", "@bobjones", "Hey Bob"])

    file_path = tmp_path / "test_contacts.xlsx"
    wb.save(file_path)

    adapter = LocalXlsxSource(file_path=str(file_path))
    records = await adapter.read_records()
    assert len(records) == 2
    assert records[0]["normalized"]["username"] == "alice_smith"
    assert records[0]["normalized"]["name"] == "Alice Smith"
    assert records[0]["normalized"]["message"] == "Hello Alice!"
    assert records[1]["normalized"]["username"] == "bobjones"
