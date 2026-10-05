"""
Message Matcher Utility:
Differentiates between automated sequence messages (Initial DM, Follow-up 1, Follow-up 2, default copy)
and external human messages sent directly on Instagram.
"""
from typing import Optional, List
from backend.database.models import Contact
from backend.config.settings import settings

DEFAULT_SYSTEM_COPIES = [
    "hey! just following up on my previous message",
    "hey! one final quick check-in",
    "would love to connect",
    "let me know if you'd like more details"
]

def is_system_sequence_message(message_text: str, contact: Optional[Contact] = None) -> bool:
    """
    Returns True if message_text matches an expected system sequence template,
    or False if it represents an external message sent by a human operator on Instagram.
    """
    clean = (message_text or "").strip().lower()
    if not clean or len(clean) < 3:
        return True

    expected_copies: List[str] = list(DEFAULT_SYSTEM_COPIES)
    if settings.DEFAULT_MESSAGE:
        expected_copies.append(settings.DEFAULT_MESSAGE.strip().lower())
    if contact:
        if contact.message:
            expected_copies.append(contact.message.strip().lower())
        if getattr(contact, "custom_message", None):
            expected_copies.append(str(contact.custom_message).strip().lower())
        if contact.followup_1_message:
            expected_copies.append(contact.followup_1_message.strip().lower())
        if contact.followup_2_message:
            expected_copies.append(contact.followup_2_message.strip().lower())

    for exp in expected_copies:
        if not exp:
            continue
        # Direct substring matching or prefix matching
        if exp in clean or clean in exp or (len(clean) >= 20 and clean[:20] in exp):
            return True

    return False
