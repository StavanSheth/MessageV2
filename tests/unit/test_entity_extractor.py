import pytest
from backend.services.entity_extractor import (
    extract_phone,
    extract_email,
    extract_links,
    is_automated_message,
    extract_all,
)

def test_extract_phone_numbers():
    text1 = "Hi, thank you for reaching out! You can call us on 0161 439 9856 during office hours."
    assert extract_phone(text1) == "0161 439 9856"

    text2 = "Contact our support line at +1 800-555-0199 for quick assistance."
    phone2 = extract_phone(text2)
    assert phone2 is not None
    assert "800" in phone2

    text3 = "No phone numbers here, just text."
    assert extract_phone(text3) is None

def test_extract_email_addresses():
    text1 = "For appointments, please email us directly at hello@amaranth-wellbeing.com or visit our store."
    assert extract_email(text1) == "hello@amaranth-wellbeing.com"

    text2 = "Drop an email to support.team@mycompany.org anytime."
    assert extract_email(text2) == "support.team@mycompany.org"

    text3 = "No email addresses here."
    assert extract_email(text3) is None

def test_extract_links():
    text1 = "Check out our latest schedule at https://www.amaranth-wellbeing.com/treatments or www.booking.co.uk"
    links = extract_links(text1)
    assert len(links) >= 1
    assert any("amaranth-wellbeing.com" in l for l in links)

    text2 = "Plain text without any website links."
    assert extract_links(text2) == []

def test_detect_automated_messages():
    auto_text = (
        "Hi, thanks for reaching out. We can't take your call right now, but please leave a message "
        "or visit www.amaranth-wellbeing.com for online booking. We will get back to you shortly!"
    )
    assert is_automated_message(auto_text) is True

    restriction_text = "This account can't receive your message because they don't allow new message requests from everyone."
    assert is_automated_message(restriction_text) is True

    human_text = "Hey Stavan! Yeah, would love to hear more about what you guys do. How much does it cost?"
    assert is_automated_message(human_text) is False

def test_extract_all_entity_package():
    sample_bubble = (
        "Hi, thanks for reaching out to Amaranth Wellbeing. Our clinic is open Monday-Saturday. "
        "For immediate booking visit https://amaranth-wellbeing.com or call 0161 439 9856. "
        "Email: bookings@amaranth.co.uk"
    )
    result = extract_all(sample_bubble)
    assert result["is_automated"] is True
    assert result["phone"] == "0161 439 9856"
    assert result["email"] == "bookings@amaranth.co.uk"
    assert "amaranth-wellbeing.com" in result["primary_link"]
