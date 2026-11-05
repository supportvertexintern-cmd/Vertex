"""The emails FastAPI sends, as a test sees them (the sent_mail fixture in
conftest.py)."""

from __future__ import annotations

import html
import re
from urllib.parse import parse_qs, urlsplit

from app.services.emails import Mail


def link(mail: Mail) -> str:
    """The email's one link into the website: its button."""
    [href] = {html.unescape(h) for h in re.findall(r'href="([^"]+)"', mail.html) if not h.startswith("mailto:")}
    return href


def token(mail: Mail) -> str:
    """The credential in that link's query."""
    [value] = [v[0] for v in parse_qs(urlsplit(link(mail)).query).values()]
    return value


def of(sent: list[Mail], kind: str) -> Mail:
    [mail] = [m for m in sent if m.kind == kind]
    return mail
