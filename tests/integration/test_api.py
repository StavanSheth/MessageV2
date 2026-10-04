import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "service" in data

@pytest.mark.asyncio
async def test_get_contacts_empty(client: AsyncClient):
    response = await client.get("/api/contacts")
    assert response.status_code == 200
    assert response.json() == []

@pytest.mark.asyncio
async def test_get_tasks_empty(client: AsyncClient):
    response = await client.get("/api/tasks")
    assert response.status_code == 200
    assert response.json() == []

@pytest.mark.asyncio
async def test_automation_status(client: AsyncClient):
    response = await client.get("/api/automation/status")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "task_counts" in data

@pytest.mark.asyncio
async def test_upload_xlsx(client: AsyncClient):
    with open("data/samples/sample_contacts.xlsx", "rb") as f:
        files = {"file": ("sample_contacts.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        response = await client.post("/api/sources/upload", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["total_records"] == 2
    assert data["valid_records"] == 2
    assert data["tasks_created"] == 2

    # Check contacts list
    c_res = await client.get("/api/contacts")
    assert c_res.status_code == 200
    assert len(c_res.json()) == 2

    # Check tasks list
    t_res = await client.get("/api/tasks")
    assert t_res.status_code == 200
    assert len(t_res.json()) == 2

@pytest.mark.asyncio
async def test_export_excel(client: AsyncClient):
    response = await client.get("/api/contacts/export/excel")
    assert response.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in response.headers.get("content-type", "")
    assert len(response.content) > 100

@pytest.mark.asyncio
async def test_automation_start_with_batch(client: AsyncClient):
    response = await client.post("/api/automation/start", json={"batch_limit": 5, "delay_seconds": 15})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "started"
    assert data["batch_limit"] == 5
    assert data["delay_seconds"] == 15
    # Clean up by stopping
    await client.post("/api/automation/stop")



