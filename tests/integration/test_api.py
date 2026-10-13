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
@pytest.mark.asyncio
async def test_tasks_bulk_update_and_bulk_delete(client: AsyncClient):
    # Upload sample to have tasks
    with open("data/samples/sample_contacts.xlsx", "rb") as f:
        files = {"file": ("sample_contacts.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        await client.post("/api/sources/upload", files=files)

    t_res = await client.get("/api/tasks")
    tasks = t_res.json()
    assert len(tasks) >= 2
    task_ids = [t["id"] for t in tasks[:2]]

    # Test bulk-update
    update_res = await client.post("/api/tasks/bulk-update", json={
        "task_ids": task_ids,
        "updates": {
            "priority": 1,
            "status": "QUEUED"
        }
    })
    assert update_res.status_code == 200
    assert update_res.json()["updated_count"] == 2

    # Verify updated tasks
    t_res_after = await client.get("/api/tasks")
    updated_tasks = [t for t in t_res_after.json() if t["id"] in task_ids]
    for t in updated_tasks:
        assert t["priority"] == 1

    # Test bulk-delete
    del_res = await client.post("/api/tasks/bulk-delete", json={
        "task_ids": task_ids
    })
    assert del_res.status_code == 200
    assert del_res.json()["deleted_count"] == 2

    # Verify tasks removed
    t_res_final = await client.get("/api/tasks")
    remaining_ids = [t["id"] for t in t_res_final.json()]
    for tid in task_ids:
        assert tid not in remaining_ids

@pytest.mark.asyncio
async def test_contacts_bulk_update_and_bulk_delete(client: AsyncClient):
    with open("data/samples/sample_contacts.xlsx", "rb") as f:
        files = {"file": ("sample_contacts.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        await client.post("/api/sources/upload", files=files)

    c_res = await client.get("/api/contacts")
    contacts = c_res.json()
    assert len(contacts) >= 2
    contact_ids = [c["id"] for c in contacts[:2]]

    # Bulk update contacts
    update_res = await client.post("/api/contacts/bulk-update", json={
        "contact_ids": contact_ids,
        "updates": {
            "replied_status": "YES"
        }
    })
    assert update_res.status_code == 200
    assert update_res.json()["updated_count"] == 2

    # Verify updated contacts
    c_res_after = await client.get("/api/contacts")
    updated_contacts = [c for c in c_res_after.json() if c["id"] in contact_ids]
    for c in updated_contacts:
        assert c["replied_status"] == "YES"

    # Bulk delete contacts
    del_res = await client.post("/api/contacts/bulk-delete", json={
        "contact_ids": contact_ids
    })
    assert del_res.status_code == 200
    assert del_res.json()["deleted_count"] == 2

