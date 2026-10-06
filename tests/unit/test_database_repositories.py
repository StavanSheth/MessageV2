import pytest
from backend.repositories import (
    ContactRepository,
    MessageRepository,
    VerificationRepository,
    TaskRepository,
)
from backend.database.models import Contact

@pytest.mark.asyncio
async def test_update_contact_details_kwargs_and_dict(test_session):
    repo = ContactRepository(test_session)
    contact = await repo.create(
        name="Original Name",
        instagram_url="https://www.instagram.com/test_user/",
        username="test_user"
    )
    assert contact.id is not None

    # Test updating via keyword arguments (as called by FastAPI route PATCH /api/contacts/{id})
    updated = await repo.update_contact_details(
        contact_id=contact.id,
        name="Updated Name",
        notes="Important client note",
        expected_followers=1500
    )
    assert updated is not None
    assert updated.name == "Updated Name"
    assert updated.notes == "Important client note"
    assert updated.expected_followers == 1500

    # Test updating via data dict
    updated2 = await repo.update_contact_details(
        contact_id=contact.id,
        data={"name": "Dict Name", "is_archived": True}
    )
    assert updated2 is not None
    assert updated2.name == "Dict Name"
    assert updated2.is_archived is True

@pytest.mark.asyncio
async def test_modular_repository_imports(test_session):
    # Verify modular repository classes instantiate cleanly with test_session
    m_repo = MessageRepository(test_session)
    v_repo = VerificationRepository(test_session)
    t_repo = TaskRepository(test_session)
    assert m_repo.session is test_session
    assert v_repo.session is test_session
    assert t_repo.session is test_session
