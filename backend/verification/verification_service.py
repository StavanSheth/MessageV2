from typing import Optional, List, Dict, Any
from backend.domain.enums import VerificationDecision
from backend.domain.models import VerificationSignal, VerificationOutput
from backend.config.settings import settings

class VerificationService:
    def __init__(self, threshold: Optional[float] = None):
        self.threshold = threshold or settings.VERIFICATION_THRESHOLD

    async def extract_signals(self, expected: Dict[str, Any], extracted: Dict[str, Any]) -> List[VerificationSignal]:
        signals = []

        # URL match (strongest)
        exp_url = (expected.get("instagram_url") or "").rstrip("/").lower()
        ext_url = (extracted.get("url") or "").rstrip("/").lower()
        if exp_url and ext_url:
            url_score = 1.0 if exp_url in ext_url or ext_url in exp_url else 0.0
            signals.append(VerificationSignal(
                name="url", expected=exp_url, extracted=ext_url,
                score=url_score, weight=0.4, notes="URL comparison"
            ))

        # Username match (strong)
        exp_user = (expected.get("username") or "").lower().lstrip("@")
        ext_user = (extracted.get("username") or "").lower().lstrip("@")
        if exp_user and ext_user:
            user_score = 1.0 if exp_user == ext_user else 0.0
            signals.append(VerificationSignal(
                name="username", expected=exp_user, extracted=ext_user,
                score=user_score, weight=0.35, notes="Username comparison"
            ))

        # Display name (supporting)
        exp_name = (expected.get("name") or "").lower()
        ext_name = (extracted.get("display_name") or "").lower()
        if exp_name and ext_name:
            name_score = 1.0 if exp_name in ext_name or ext_name in exp_name else 0.3
            signals.append(VerificationSignal(
                name="display_name", expected=exp_name, extracted=ext_name,
                score=name_score, weight=0.15, notes="Display name comparison"
            ))

        # Followers (weak supporting)
        exp_followers = expected.get("expected_followers")
        ext_followers = extracted.get("followers")
        if exp_followers and ext_followers:
            ratio = min(exp_followers, ext_followers) / max(exp_followers, ext_followers) if max(exp_followers, ext_followers) > 0 else 0
            signals.append(VerificationSignal(
                name="followers", expected=exp_followers, extracted=ext_followers,
                score=ratio, weight=0.1, notes="Follower count ratio"
            ))

        return signals

    async def calculate_confidence(self, signals: List[VerificationSignal]) -> float:
        if not signals:
            return 0.0
        total_weight = sum(s.weight for s in signals)
        if total_weight == 0:
            return 0.0
        weighted_sum = sum(s.score * s.weight for s in signals)
        return round(weighted_sum / total_weight, 4)

    async def decide(self, expected: Dict[str, Any], extracted: Dict[str, Any]) -> VerificationOutput:
        signals = await self.extract_signals(expected, extracted)
        confidence = await self.calculate_confidence(signals)

        if confidence >= self.threshold:
            decision = VerificationDecision.HIGH_CONFIDENCE
            reason = "Profile matches expected identity with high confidence"
        elif confidence >= self.threshold * 0.6:
            decision = VerificationDecision.MEDIUM_CONFIDENCE
            reason = "Partial match — manual review recommended"
        elif confidence > 0:
            decision = VerificationDecision.LOW_CONFIDENCE
            reason = "Low confidence match — sending blocked"
        else:
            decision = VerificationDecision.MISMATCH
            reason = "Profile does not match expected identity"

        return VerificationOutput(
            confidence=confidence,
            signals=signals,
            decision=decision,
            reason=reason
        )
