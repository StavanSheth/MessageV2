import pytest
from unittest.mock import AsyncMock, MagicMock
from backend.automation.instagram.instagram_adapter import InstagramAdapter
from backend.domain.enums import ResultCode

@pytest.mark.asyncio
async def test_check_login_fails_closed_when_not_logged_in():
    page = MagicMock()
    page.url = "https://www.instagram.com/accounts/login/"
    page.dismiss_popups = AsyncMock()
    
    # Mock locators
    locator_mock = MagicMock()
    locator_mock.first = locator_mock
    locator_mock.count = AsyncMock(return_value=0)
    locator_mock.is_visible = AsyncMock(return_value=False)
    locator_mock.inner_text = AsyncMock(return_value="login to continue")
    page.locator = MagicMock(return_value=locator_mock)
    
    adapter = InstagramAdapter(page)
    adapter.dismiss_popups = AsyncMock()

    is_logged_in, requires_login, has_challenge, reason = await adapter.check_login()
    
    # Invariant: Must NOT assume True / logged in!
    assert is_logged_in is False
    assert requires_login is True
    assert has_challenge is False

@pytest.mark.asyncio
async def test_check_login_detects_logged_in_nav():
    page = MagicMock()
    page.url = "https://www.instagram.com/"
    
    def mock_locator(selector):
        loc = MagicMock()
        loc.first = loc
        if "Direct" in selector or "Home" in selector:
            loc.count = AsyncMock(return_value=1)
        else:
            loc.count = AsyncMock(return_value=0)
        loc.is_visible = AsyncMock(return_value=True)
        return loc

    page.locator = MagicMock(side_effect=mock_locator)
    
    adapter = InstagramAdapter(page)
    adapter.dismiss_popups = AsyncMock()

    is_logged_in, requires_login, has_challenge, reason = await adapter.check_login()
    
    assert is_logged_in is True
    assert requires_login is False
    assert has_challenge is False
