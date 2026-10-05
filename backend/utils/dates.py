"""
Authoritative datetime formatting and manipulation utilities for MessageV2.
"""
from typing import Optional
from datetime import datetime, timezone

def to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if not dt:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def format_datetime_readable(dt: Optional[datetime]) -> Optional[str]:
    """Format datetime into standard human readable string: Day, DD Mon YYYY, HH:MM:SS UTC."""
    if not dt:
        return None
    dt_utc = to_utc(dt)
    return dt_utc.strftime("%a, %d %b %Y, %H:%M:%S UTC")

def format_datetime_short(dt: Optional[datetime]) -> Optional[str]:
    """Format datetime into short readable string: Mon DD, YYYY HH:MM UTC."""
    if not dt:
        return None
    dt_utc = to_utc(dt)
    return dt_utc.strftime("%b %d, %Y %H:%M UTC")

def to_iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """Format datetime into standard ISO 8601 UTC string."""
    if not dt:
        return None
    dt_utc = to_utc(dt)
    return dt_utc.isoformat()
