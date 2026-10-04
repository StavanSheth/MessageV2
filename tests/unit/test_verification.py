import pytest
from backend.verification.verification_service import VerificationService
from backend.domain.enums import VerificationDecision

@pytest.mark.asyncio
async def test_verification_high_confidence():
    service = VerificationService(threshold=0.8)
    expected = {
        "instagram_url": "https://instagram.com/elonmusk",
        "username": "elonmusk",
        "name": "Elon Musk",
    }
    extracted = {
        "url": "https://instagram.com/elonmusk/",
        "username": "elonmusk",
        "display_name": "Elon Musk",
    }
    output = await service.decide(expected, extracted)
    assert output.decision == VerificationDecision.HIGH_CONFIDENCE
    assert output.confidence >= 0.8
    assert len(output.signals) >= 3

@pytest.mark.asyncio
async def test_verification_mismatch():
    service = VerificationService(threshold=0.8)
    expected = {
        "instagram_url": "https://instagram.com/elonmusk",
        "username": "elonmusk",
        "name": "Elon Musk",
    }
    extracted = {
        "url": "https://instagram.com/totally_different",
        "username": "totally_different",
        "display_name": "Someone Else",
    }
    output = await service.decide(expected, extracted)
    assert output.decision in (VerificationDecision.MISMATCH, VerificationDecision.LOW_CONFIDENCE)
    assert output.confidence < 0.5
