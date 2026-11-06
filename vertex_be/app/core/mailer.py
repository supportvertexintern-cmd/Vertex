"""Outgoing mail (reads handover R7, D3 and D4 A): messages over SMTP, with
the settings the website's lib/email.ts used (SMTP_*, EMAIL_FROM). R7a sends
the security alerts from here (plain text); R7b the emails a write leaves
due (HTML, app/services/emails.py), the receipt with its PDF attached.

send_mail raises on failure; callers decide whether that matters. With
SMTP_HOST unset it sends nothing and returns False.
"""

from __future__ import annotations

import smtplib
import ssl
from collections.abc import Sequence
from email.message import EmailMessage
from typing import NamedTuple

from app.core.config import settings

TIMEOUT_SECONDS = 10


class Attachment(NamedTuple):
    filename: str
    content: bytes
    content_type: str  # "application/pdf"


def send_mail(
    to: list[str], subject: str, text: str, *, html: bool = False, attachments: Sequence[Attachment] = (), reply_to: str | None = None
) -> bool:
    if not settings.SMTP_HOST:
        return False
    message = EmailMessage()
    message["From"] = settings.EMAIL_FROM
    message["To"] = ", ".join(to)
    message["Subject"] = subject
    if reply_to:
        message["Reply-To"] = reply_to
    message.set_content(text, subtype="html" if html else "plain")
    for attachment in attachments:
        maintype, subtype = attachment.content_type.split("/", 1)
        message.add_attachment(attachment.content, maintype=maintype, subtype=subtype, filename=attachment.filename)
    if settings.SMTP_SECURE:
        server: smtplib.SMTP = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context())
    else:
        server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=TIMEOUT_SECONDS)
    with server:
        if not settings.SMTP_SECURE and server.has_extn("starttls"):
            server.starttls(context=ssl.create_default_context())
        if settings.SMTP_USER:
            server.login(settings.SMTP_USER, settings.SMTP_PASS or "")
        server.send_message(message)
    return True
