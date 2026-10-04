from typing import Tuple, Optional
from backend.domain.enums import ResultCode
from backend.automation.retry.policy import RetryPolicy

class ResultDetector:
    @staticmethod
    def classify_navigation_result(status_code: Optional[int], page_text: str) -> ResultCode:
        lower_text = page_text.lower()
        if "sorry, this page isn't available" in lower_text or "page not found" in lower_text or "link you followed may be broken" in lower_text:
            return ResultCode.PROFILE_NOT_FOUND
        if "try again later" in lower_text or "we limit how often" in lower_text or "action blocked" in lower_text:
            return ResultCode.RATE_LIMITED
        if "challenge" in lower_text or "confirm your info" in lower_text or "suspicious login" in lower_text:
            return ResultCode.CHALLENGE_REQUIRED
        if "log in" in lower_text and ("password" in lower_text or "username" in lower_text):
            return ResultCode.LOGIN_REQUIRED
        return ResultCode.SUCCESS

    @staticmethod
    def classify_dm_availability(has_button: bool, page_text: str) -> Tuple[bool, ResultCode]:
        lower_text = page_text.lower()
        if "action blocked" in lower_text:
            return False, ResultCode.ACTION_BLOCKED
        if "you can't message this account" in lower_text or "cannot be messaged" in lower_text:
            return False, ResultCode.DM_NOT_AVAILABLE
        if not has_button:
            return False, ResultCode.DM_NOT_AVAILABLE
        return True, ResultCode.SUCCESS

    @staticmethod
    def is_retryable(result_code: ResultCode, attempt: int = 1) -> bool:
        decision = RetryPolicy.classify(result_code, attempt=attempt)
        return decision.should_retry
