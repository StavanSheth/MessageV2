import re
from typing import Optional, Any

# Matches {var_name} or {var_name|fallback}
VARIABLE_PATTERN = re.compile(r"\{([a-zA-Z0-9_@]+)(?:\|([^}]+))?\}")

def extract_first_name(full_name: Optional[str]) -> Optional[str]:
    """
    Extracts a clean first name from a full name.
    Ignores numeric strings and handles common formatting.
    """
    if not full_name:
        return None
    cleaned = full_name.strip()
    if not cleaned or cleaned.isdigit():
        return None
    parts = cleaned.split()
    return parts[0] if parts else None

def format_message(template: Optional[str], contact: Any) -> str:
    """
    Resolves dynamic personalization variables in a message template.
    Supported variables:
      - {first_name} or {first_name|fallback}: First name (e.g. 'Sarah'), or fallback (e.g. 'there' or '@handle')
      - {name} or {name|fallback}: Full name (e.g. 'Sarah Connor'), or fallback
      - {username} or {handle} or {insta_id}: Instagram handle without @
      - {@username} or {@handle}: Instagram handle with @
    """
    if not template:
        return ""
    if not contact:
        return template

    name = getattr(contact, "name", None) or ""
    username = getattr(contact, "username", None) or ""
    first_name = extract_first_name(name)

    def replacer(match: re.Match) -> str:
        var_name = match.group(1).lower()
        pipe_fallback = match.group(2)

        if var_name in ["first_name", "firstname"]:
            if first_name:
                return first_name
            if pipe_fallback is not None:
                return pipe_fallback
            return f"@{username}" if username else "there"

        elif var_name in ["name", "full_name"]:
            if name and not name.isdigit():
                return name
            if pipe_fallback is not None:
                return pipe_fallback
            return f"@{username}" if username else "there"

        elif var_name in ["username", "insta_id", "instagram_id", "handle"]:
            return username or (pipe_fallback if pipe_fallback is not None else "")

        elif var_name in ["@username", "@handle", "@insta_id"]:
            return f"@{username}" if username else (pipe_fallback if pipe_fallback is not None else "")

        return match.group(0)

    return VARIABLE_PATTERN.sub(replacer, template)
