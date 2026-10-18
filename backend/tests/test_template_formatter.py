import pytest
from dataclasses import dataclass
from typing import Optional
from backend.automation.template_formatter import format_message, extract_first_name
from backend.automation.message_matcher import is_system_sequence_message

@dataclass
class DummyContact:
    name: Optional[str]
    username: Optional[str]
    message: Optional[str] = None
    followup_1_message: Optional[str] = None
    followup_2_message: Optional[str] = None

def test_extract_first_name():
    assert extract_first_name("Sarah Connor") == "Sarah"
    assert extract_first_name("  John   Doe ") == "John"
    assert extract_first_name("Alice") == "Alice"
    assert extract_first_name("") is None
    assert extract_first_name(None) is None
    assert extract_first_name("123456") is None

def test_format_message_with_full_details():
    c = DummyContact(name="Sarah Connor", username="sarah_c")
    tpl = "Hey {first_name}! Loved your profile @{username} ({name})."
    res = format_message(tpl, c)
    assert res == "Hey Sarah! Loved your profile @sarah_c (Sarah Connor)."

def test_format_message_missing_name_default_fallback():
    c = DummyContact(name=None, username="sarah_c")
    tpl = "Hey {first_name}, saw your page!"
    res = format_message(tpl, c)
    assert res == "Hey @sarah_c, saw your page!"

def test_format_message_missing_name_pipe_fallback():
    c = DummyContact(name="", username="sarah_c")
    tpl = "Hey {first_name|there}, saw your page!"
    res = format_message(tpl, c)
    assert res == "Hey there, saw your page!"

def test_format_message_at_username_tag():
    c = DummyContact(name="Alex Smith", username="alex_design")
    tpl = "Check out {@username}"
    res = format_message(tpl, c)
    assert res == "Check out @alex_design"

def test_format_message_numeric_name_fallback():
    c = DummyContact(name="987654321", username="alex_design")
    tpl = "Hey {first_name|friend}, what's up?"
    res = format_message(tpl, c)
    assert res == "Hey friend, what's up?"

def test_format_message_no_placeholders():
    c = DummyContact(name="Alex", username="alex")
    tpl = "Hello, this is a plain message."
    assert format_message(tpl, c) == tpl

def test_format_message_empty_template():
    c = DummyContact(name="Alex", username="alex")
    assert format_message("", c) == ""
    assert format_message(None, c) == ""

def test_is_system_sequence_message_with_personalization():
    c = DummyContact(name="Sarah Connor", username="sarah_c")
    c.message = "Hey {first_name}, loved your recent work!"
    c.followup_1_message = "Hey {name|there}, following up!"
    c.followup_2_message = None

    # Exact resolved copy should match as system message
    assert is_system_sequence_message("Hey Sarah, loved your recent work!", c) is True
    assert is_system_sequence_message("Hey Sarah Connor, following up!", c) is True
    # An actual lead reply should NOT match as system sequence
    assert is_system_sequence_message("Sounds great, what is your pricing?", c) is False
