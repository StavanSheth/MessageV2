"""
Entity extraction service for contact phone numbers, emails, URLs,
and automated auto-responder detection.
"""
import re
from typing import Dict, Optional, List

# Regex patterns
# Handles UK local/national (01xx, 02xx, 07xx, 08xx), +44 format, and international formats
PHONE_REGEX = re.compile(
    r'(?:(?:\+44\s?\(0\)\s?|\+44\s?|0)(?:\d{2,5}\s?\d{3,4}\s?\d{3,4}|\d{10,11}))'
    r'|'
    r'(?:\+?\d{1,3}[-.\s]?(?:\(\d{1,4}\)|\d{1,4})[-.\s]?\d{1,4}[-.\s]?\d{1,9})'
)

EMAIL_REGEX = re.compile(
    r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+'
)

URL_REGEX = re.compile(
    r'(?:https?://[^\s<>"]+|www\.[^\s<>"]+|[a-zA-Z0-9-]+\.(?:co\.uk|com|org|io|store|co|net)[^\s<>"]*)'
)

AUTO_RESPONDER_KEYWORDS = [
    "thanks for contacting",
    "thank you for contacting",
    "thanks for reaching out",
    "thank you for reaching out",
    "we aim to respond",
    "working hours",
    "urgent enquiry",
    "urgent inquiry",
    "call the shop",
    "call our shop",
    "call us at",
    "call us on",
    "automated message",
    "instant reply",
    "auto-reply",
    "currently away",
    "out of the office",
    "out of office",
    "we will get back to you",
    "will be in touch",
    "our team will respond",
    "within 24 hours",
    "within 48 hours",
    "mon-fri",
    "monday to saturday",
    "monday to friday",
    "can't receive your message",
    "cannot receive your message",
    "don't allow new message requests",
    "do not allow new message requests",
    "this account can't receive",
]

class EntityExtractor:
    @staticmethod
    def extract_all(text: str) -> Dict[str, Optional[str]]:
        if not text:
            return {
                "phone": None,
                "email": None,
                "link": None,
                "is_automated": False
            }

        # 1. Emails
        emails = EMAIL_REGEX.findall(text)
        email = emails[0].strip(".,;:)") if emails else None

        # 2. URLs
        urls = URL_REGEX.findall(text)
        link = None
        if urls:
            cand = urls[0].strip(".,;:)")
            if cand.startswith("www."):
                link = f"https://{cand}"
            elif cand.startswith("http"):
                link = cand
            else:
                link = f"https://{cand}"

        # 3. Phone Numbers
        # Exclude pure years or small numbers by verifying at least 7 digits
        phones = PHONE_REGEX.findall(text)
        valid_phone = None
        for p in phones:
            digits_only = re.sub(r'\D', '', p)
            if len(digits_only) >= 7 and not (len(digits_only) == 4 and digits_only.startswith("20")):
                valid_phone = p.strip(".,;:)")
                break

        # 4. Auto-Responder classification
        lower = text.lower()
        is_automated = any(kw in lower for kw in AUTO_RESPONDER_KEYWORDS)

        return {
            "phone": valid_phone,
            "email": email,
            "link": link,
            "is_automated": is_automated
        }

entity_extractor = EntityExtractor()

def extract_phone(text: str) -> Optional[str]:
    return EntityExtractor.extract_all(text)["phone"]

def extract_email(text: str) -> Optional[str]:
    return EntityExtractor.extract_all(text)["email"]

def extract_links(text: str) -> List[str]:
    urls = URL_REGEX.findall(text)
    links = []
    for cand in urls:
        c = cand.strip(".,;:)")
        if c.startswith("www."):
            links.append(f"https://{c}")
        elif c.startswith("http"):
            links.append(c)
        else:
            links.append(f"https://{c}")
    return links

def is_automated_message(text: str) -> bool:
    return EntityExtractor.extract_all(text)["is_automated"]

def extract_all(text: str) -> Dict[str, any]:
    res = EntityExtractor.extract_all(text)
    res["primary_link"] = res["link"]
    return res
