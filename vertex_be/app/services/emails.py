"""The emails a write leaves due, sent by FastAPI (reads handover R7b, D4 A).

A write lists its emails in `notify` (app/api/notices.py). `deliver()` takes
the kinds this service sends out of that list, renders them and sends them
off the request, as the website's `after(() => sendNotices(...))` did, and
returns the rest for the website to send until every kind has moved.

The templates are lib/email.ts's own, captured by the website's
src/lib/email-templates.test.ts into app/assets/email_templates.json, each
with the `{{name}}` placeholders its EmailTemplate override (by `event`)
uses. Values are HTML-escaped into the body, unlike lib/email.ts, which put
them in as they came. A link is a credential: nothing here logs a notice's
fields, only its kind.
"""

from __future__ import annotations

import base64
import html
import json
import logging
import re
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.logging import log_event
from app.core.mailer import send_mail
from app.core.tokens import sign_candidate_invite_token
from app.models.reference import EmailTemplate

ASSETS = Path(__file__).resolve().parent.parent / "assets"
TEMPLATES: dict[str, dict[str, str | None]] = json.loads((ASSETS / "email_templates.json").read_text(encoding="utf-8"))
LOGO = "data:image/png;base64," + base64.b64encode((ASSETS / "vertex-logo.png").read_bytes()).decode("ascii")
PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


@dataclass(frozen=True)
class Mail:
    kind: str
    to: str
    subject: str
    html: str


def _url(path: str) -> str:
    return f"{settings.APP_URL}{path}"


# Each kind this service sends: its recipient and its template's values.
Values = Callable[[BaseModel], tuple[str, dict[str, str]]]
VALUES: dict[str, Values] = {
    "email_verification": lambda n: (n.email, {"fullName": n.full_name, "verifyUrl": _url(f"/auth/verify-email?token={n.token}")}),
    "password_reset": lambda n: (n.email, {"fullName": n.full_name, "resetUrl": _url(f"/auth/reset-password?token={n.token}")}),
    "account_setup": lambda n: (n.email, {"name": n.full_name, "setupUrl": _url(f"/auth/register?setup={n.token}")}),
    "candidate_invite": lambda n: (
        n.email,
        {"name": n.full_name, "registerUrl": _url(f"/auth/register?invite={sign_candidate_invite_token(n.candidate_id)}")},
    ),
    "referral_agent_application": lambda n: (
        n.email,
        {"fullName": n.full_name, "verifyUrl": _url(f"/become-a-referral-agent/verify-email?token={n.token}")},
    ),
}
SENT_HERE = frozenset(VALUES)


def _fill(text: str, values: dict[str, str], *, escape: bool) -> str:
    def one(match: re.Match[str]) -> str:
        value = values.get(match.group(1))
        if value is None:
            return match.group(0)  # as lib/email.ts left a placeholder it didn't fill
        return html.escape(value) if escape else value

    return PLACEHOLDER.sub(one, text)


def _override(db: Session, event: str | None) -> tuple[str, str] | None:
    if not event:
        return None
    try:
        row = db.get(EmailTemplate, event)
    except Exception:  # noqa: BLE001 - the default still goes, as in lib/email.ts
        log_event(logging.WARNING, "email.template_unreadable", event=event)
        return None
    return (row.subject, row.body_html) if row else None


def render(db: Session, kind: str, values: dict[str, str]) -> tuple[str, str]:
    """The subject and HTML body for one kind, with an admin's override."""
    template = TEMPLATES[kind]
    subject, body = _override(db, template["event"]) or (template["subject"] or "", template["html"] or "")
    values = {**values, "logo": LOGO, "year": str(utc_now_ms().year)}
    return _fill(subject, values, escape=False), _fill(body, values, escape=True)


def _in_background(send: Callable[[], None]) -> None:
    threading.Thread(target=send, daemon=True).start()


# Off the request, so a slow mail server never holds one. Tests send in line.
dispatch: Callable[[Callable[[], None]], None] = _in_background


def _send(mails: list[Mail]) -> None:
    for mail in mails:
        try:
            send_mail([mail.to], mail.subject, mail.html, html=True)
        except Exception as err:  # noqa: BLE001 - one failure doesn't stop the rest
            log_event(logging.ERROR, "email.send_failed", kind=mail.kind, error=type(err).__name__)


def deliver(db: Session, notify: Sequence[BaseModel]) -> list[BaseModel]:
    """Sends the kinds this service sends, after the write has committed;
    returns the rest for the website."""
    kept: list[BaseModel] = []
    mails: list[Mail] = []
    for notice in notify:
        kind = getattr(notice, "kind", None)
        if kind not in SENT_HERE:
            kept.append(notice)
            continue
        try:
            to, values = VALUES[kind](notice)
            subject, body = render(db, kind, values)
        except Exception as err:  # noqa: BLE001 - the write stands; the email is lost, as when sending fails
            log_event(logging.ERROR, "email.render_failed", kind=kind, error=type(err).__name__)
            continue
        mails.append(Mail(kind, to, subject, body))
    if mails:
        dispatch(lambda: _send(mails))
    return kept
