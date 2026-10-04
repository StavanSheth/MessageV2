from enum import Enum
from typing import Optional
from datetime import datetime, timezone, timedelta
from pydantic import BaseModel
from backend.domain.enums import ResultCode
from backend.config.settings import settings

class RetryCategory(str, Enum):
    RETRYABLE_TRANSIENT = "RETRYABLE_TRANSIENT"
    RETRYABLE_NETWORK = "RETRYABLE_NETWORK"
    RETRYABLE_BROWSER_RECOVERY = "RETRYABLE_BROWSER_RECOVERY"
    WAIT_REQUIRED = "WAIT_REQUIRED"
    NON_RETRYABLE = "NON_RETRYABLE"
    UNKNOWN_REQUIRES_RECONCILIATION = "UNKNOWN_REQUIRES_RECONCILIATION"
    MANUAL_REVIEW = "MANUAL_REVIEW"

class RetryDecision(BaseModel):
    should_retry: bool
    category: RetryCategory
    reason: str
    attempt: int
    max_attempts: int
    delay_seconds: float
    next_retry_at: Optional[datetime] = None
    requires_reconciliation: bool = False
    requires_manual_review: bool = False

class RetryPolicy:
    @staticmethod
    def classify(result_code: ResultCode, attempt: int = 1, error_message: str = "") -> RetryDecision:
        now = datetime.now(timezone.utc)
        max_attempts = settings.MAX_SEND_RETRIES

        # 1. UNKNOWN / SEND_UNKNOWN -> Never ordinary retry! Must reconcile conversation first.
        if result_code in {ResultCode.UNKNOWN, ResultCode.SEND_UNKNOWN}:
            return RetryDecision(
                should_retry=False,
                category=RetryCategory.UNKNOWN_REQUIRES_RECONCILIATION,
                reason=f"Ambiguous send result ({result_code.value}). Must reconcile conversation before retry.",
                attempt=attempt,
                max_attempts=max_attempts,
                delay_seconds=0.0,
                next_retry_at=None,
                requires_reconciliation=True,
                requires_manual_review=False
            )

        # 2. Rate limited / Action block -> Wait required or non-retryable
        if result_code == ResultCode.RATE_LIMITED:
            return RetryDecision(
                should_retry=False,
                category=RetryCategory.WAIT_REQUIRED,
                reason="Instagram rate limit triggered. Pacing pause required.",
                attempt=attempt,
                max_attempts=max_attempts,
                delay_seconds=300.0,
                next_retry_at=now + timedelta(seconds=300),
                requires_reconciliation=False,
                requires_manual_review=True
            )

        if result_code == ResultCode.ACTION_BLOCKED:
            return RetryDecision(
                should_retry=False,
                category=RetryCategory.NON_RETRYABLE,
                reason="Instagram action blocked. Automation must halt.",
                attempt=attempt,
                max_attempts=max_attempts,
                delay_seconds=0.0,
                next_retry_at=None,
                requires_reconciliation=False,
                requires_manual_review=True
            )

        # 3. Deterministic failure -> Non-retryable
        if result_code in {
            ResultCode.PROFILE_NOT_FOUND,
            ResultCode.PROFILE_UNAVAILABLE,
            ResultCode.PROFILE_MISMATCH,
            ResultCode.PROFILE_PRIVATE,
            ResultCode.DM_NOT_AVAILABLE,
            ResultCode.LOGIN_REQUIRED,
            ResultCode.CHALLENGE_REQUIRED
        }:
            return RetryDecision(
                should_retry=False,
                category=RetryCategory.NON_RETRYABLE,
                reason=f"Deterministic failure: {result_code.value} - {error_message or 'No retry allowed'}",
                attempt=attempt,
                max_attempts=max_attempts,
                delay_seconds=0.0,
                next_retry_at=None,
                requires_reconciliation=False,
                requires_manual_review=False
            )

        # 4. Network / Timeout -> Retryable with exponential backoff up to max_attempts
        if result_code in {ResultCode.NETWORK_ERROR, ResultCode.TIMEOUT}:
            if attempt < max_attempts:
                delay = settings.NETWORK_BACKOFF_BASE ** attempt
                return RetryDecision(
                    should_retry=True,
                    category=RetryCategory.RETRYABLE_NETWORK,
                    reason=f"Transient network/timeout ({result_code.value}). Backoff retry {attempt}/{max_attempts}.",
                    attempt=attempt,
                    max_attempts=max_attempts,
                    delay_seconds=delay,
                    next_retry_at=now + timedelta(seconds=delay),
                    requires_reconciliation=False,
                    requires_manual_review=False
                )
            else:
                return RetryDecision(
                    should_retry=False,
                    category=RetryCategory.NON_RETRYABLE,
                    reason=f"Max network retry attempts exceeded ({attempt}/{max_attempts}).",
                    attempt=attempt,
                    max_attempts=max_attempts,
                    delay_seconds=0.0,
                    next_retry_at=None,
                    requires_reconciliation=False,
                    requires_manual_review=True
                )

        # 5. Composer unavailable / transient DOM error
        if result_code == ResultCode.COMPOSER_UNAVAILABLE:
            if attempt < 2:
                delay = 5.0
                return RetryDecision(
                    should_retry=True,
                    category=RetryCategory.RETRYABLE_TRANSIENT,
                    reason="Composer unavailable. One transient retry allowed.",
                    attempt=attempt,
                    max_attempts=2,
                    delay_seconds=delay,
                    next_retry_at=now + timedelta(seconds=delay),
                    requires_reconciliation=False,
                    requires_manual_review=False
                )
            else:
                return RetryDecision(
                    should_retry=False,
                    category=RetryCategory.NON_RETRYABLE,
                    reason="Composer unavailable after retry.",
                    attempt=attempt,
                    max_attempts=2,
                    delay_seconds=0.0,
                    next_retry_at=None,
                    requires_reconciliation=False,
                    requires_manual_review=True
                )

        # 6. Generic send failure
        return RetryDecision(
            should_retry=False,
            category=RetryCategory.MANUAL_REVIEW,
            reason=f"Send failed: {result_code.value}. Manual review required.",
            attempt=attempt,
            max_attempts=max_attempts,
            delay_seconds=0.0,
            next_retry_at=None,
            requires_reconciliation=False,
            requires_manual_review=True
        )
