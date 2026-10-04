import pytest
from unittest.mock import AsyncMock, MagicMock
from backend.automation.instagram.instagram_adapter import InstagramAdapter
from backend.domain.enums import ResultCode, VerificationDecision
from backend.verification.verification_service import VerificationService
from backend.automation.retry.policy import RetryPolicy, RetryCategory

class FakeLocator:
    def __init__(self, count_val=0, is_visible_val=False, text_val="", attr_val=None):
        self._count_val = count_val
        self._is_visible_val = is_visible_val
        self._text_val = text_val
        self._attr_val = attr_val

    @property
    def first(self):
        return self

    @property
    def last(self):
        return self

    async def count(self):
        return self._count_val

    async def is_visible(self):
        return self._is_visible_val

    async def inner_text(self):
        return self._text_val

    async def text_content(self):
        return self._text_val

    async def get_attribute(self, name):
        return self._attr_val

    async def click(self, **kwargs):
        pass

@pytest.fixture
def fake_page():
    page = MagicMock()
    page.url = "https://www.instagram.com/testuser/"
    page.goto = AsyncMock()
    page.bring_to_front = AsyncMock()
    page.content = AsyncMock(return_value="<html><body></body></html>")
    page.keyboard = MagicMock()
    page.keyboard.press = AsyncMock()
    page.keyboard.type = AsyncMock()
    page.keyboard.insert_text = AsyncMock()
    return page

@pytest.mark.asyncio
async def test_profile_not_found(fake_page):
    body_loc = FakeLocator(count_val=1, text_val="Sorry, this page isn't available. The link you followed may be broken.")
    fake_page.locator.return_value = body_loc
    adapter = InstagramAdapter(fake_page)

    success, code, reason = await adapter.open_profile("https://www.instagram.com/deleted_user/")
    assert success is False
    assert code == ResultCode.PROFILE_NOT_FOUND

@pytest.mark.asyncio
async def test_profile_private(fake_page):
    def locator_side_effect(selector):
        if selector == "body":
            return FakeLocator(count_val=1, text_val="This Account is Private. Follow to see photos.")
        if "header" in selector:
            return FakeLocator(count_val=1, is_visible_val=True, text_val="testuser\n100 posts\n500 followers")
        return FakeLocator(count_val=0)

    fake_page.locator.side_effect = locator_side_effect
    adapter = InstagramAdapter(fake_page)

    success, code, reason = await adapter.open_profile("https://www.instagram.com/testuser/", expected_username="testuser")
    assert code == ResultCode.PROFILE_PRIVATE

@pytest.mark.asyncio
async def test_profile_mismatch_and_username_mismatch(fake_page):
    def locator_side_effect(selector):
        if selector == "body":
            return FakeLocator(count_val=1, text_val="wronguser profile header")
        if "header h2" in selector or "header" in selector:
            return FakeLocator(count_val=1, is_visible_val=True, text_val="wronguser")
        return FakeLocator(count_val=0)

    fake_page.locator.side_effect = locator_side_effect
    adapter = InstagramAdapter(fake_page)

    success, code, reason = await adapter.open_profile("https://www.instagram.com/wronguser/", expected_username="expecteduser")
    assert success is False
    assert code == ResultCode.PROFILE_MISMATCH

@pytest.mark.asyncio
async def test_login_required_and_challenge(fake_page):
    fake_page.url = "https://www.instagram.com/accounts/login/"
    adapter = InstagramAdapter(fake_page)

    success, code, reason = await adapter.open_profile("https://www.instagram.com/testuser/")
    assert success is False
    assert code == ResultCode.LOGIN_REQUIRED

    fake_page.url = "https://www.instagram.com/challenge/action/"
    success, code, reason = await adapter.open_profile("https://www.instagram.com/testuser/")
    assert success is False
    assert code == ResultCode.CHALLENGE_REQUIRED

@pytest.mark.asyncio
async def test_dm_unavailable_restricted(fake_page):
    fake_page.content = AsyncMock(return_value="<html><body>You can't message this account</body></html>")
    fake_page.locator.return_value = FakeLocator(count_val=0)
    adapter = InstagramAdapter(fake_page)

    available, code, reason = await adapter.check_message_availability()
    assert available is False
    assert code == ResultCode.DM_NOT_AVAILABLE

@pytest.mark.asyncio
async def test_composer_unavailable(fake_page):
    fake_page.url = "https://www.instagram.com/direct/t/123/"
    fake_page.locator.return_value = FakeLocator(count_val=0)  # Composer not found
    adapter = InstagramAdapter(fake_page)

    prepared, code, reason = await adapter.prepare_message("Hello!")
    assert prepared is False
    assert code == ResultCode.COMPOSER_UNAVAILABLE

@pytest.mark.asyncio
async def test_send_unknown_never_treats_empty_composer_as_success(fake_page):
    """
    CRITICAL INVARIANT:
    Empty composer alone MUST NOT be treated as success!
    Without visible message bubble, detect_result must return SEND_UNKNOWN.
    """
    fake_page.content = AsyncMock(return_value="<html><body><div>Thread</div></body></html>")
    # Message bubble with expected text not visible
    fake_page.locator.return_value = FakeLocator(count_val=0, is_visible_val=False)
    adapter = InstagramAdapter(fake_page)

    result = await adapter.detect_result("Unique outreach message 12345")
    assert result == ResultCode.SEND_UNKNOWN

    # Verify that RetryPolicy forbids automatic retry on SEND_UNKNOWN
    decision = RetryPolicy.classify(result)
    assert decision.should_retry is False
    assert decision.requires_reconciliation is True
    assert decision.category == RetryCategory.UNKNOWN_REQUIRES_RECONCILIATION

@pytest.mark.asyncio
async def test_rate_limit_and_action_block_detection(fake_page):
    fake_page.content = AsyncMock(return_value="<html><body>Action Blocked: We limit how often you can do certain things</body></html>")
    adapter = InstagramAdapter(fake_page)

    result = await adapter.detect_result("Hey")
    assert result in {ResultCode.ACTION_BLOCKED, ResultCode.RATE_LIMITED}

    decision = RetryPolicy.classify(result)
    assert decision.should_retry is False
    assert decision.requires_manual_review is True

@pytest.mark.asyncio
async def test_verification_confidence_decision():
    verifier = VerificationService(threshold=0.75)

    # 1. Missing identity data -> UNKNOWN
    res_unknown = await verifier.decide(
        {"instagram_url": "https://instagram.com/user1", "username": "user1"},
        {}
    )
    assert res_unknown.decision == VerificationDecision.UNKNOWN

    # 2. Explicit username mismatch -> MISMATCH
    res_mismatch = await verifier.decide(
        {"instagram_url": "https://instagram.com/user1", "username": "user1"},
        {"username": "otheruser", "url": "https://instagram.com/otheruser"}
    )
    assert res_mismatch.decision == VerificationDecision.MISMATCH

    # 3. High confidence match
    res_high = await verifier.decide(
        {"instagram_url": "https://instagram.com/user1", "username": "user1", "name": "User One"},
        {"username": "user1", "url": "https://instagram.com/user1", "display_name": "User One"}
    )
    assert res_high.decision == VerificationDecision.HIGH_CONFIDENCE
