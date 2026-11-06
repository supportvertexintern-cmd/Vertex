"""The emails a write leaves due, sent by FastAPI (reads handover R7b, D4 A).

A write lists its emails in `notify` (app/api/notices.py). `deliver()`
renders them and sends them off the request, as the website's
`after(() => sendNotices(...))` did. Since R7b's third batch every kind is
sent here; `deliver()` still returns any kind it doesn't send, and
tests/test_notices.py checks there is none.

The templates are lib/email.ts's own, captured by the website's
src/lib/email-templates.test.ts into app/assets/email_templates.json, each
with the `{{name}}` placeholders its EmailTemplate override (by `event`)
uses. Values are HTML-escaped into the body, unlike lib/email.ts, which put
them in as they came; the only HTML put in as it is is built here from the
template's own `parts` (the payment plan's rows), its values escaped. A link
is a credential: nothing here logs a notice's fields, only its kind.
"""

from __future__ import annotations

import base64
import html
import json
import logging
import math
import re
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.logging import log_event
from app.core.mailer import Attachment, send_mail
from app.core.tokens import sign_candidate_invite_token
from app.models.reference import EmailTemplate
from app.services.receipt import receipt_pdf

ASSETS = Path(__file__).resolve().parent.parent / "assets"
TEMPLATES: dict[str, dict[str, Any]] = json.loads((ASSETS / "email_templates.json").read_text(encoding="utf-8"))
LOGO = "data:image/png;base64," + base64.b64encode((ASSETS / "vertex-logo.png").read_bytes()).decode("ascii")
PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


@dataclass(frozen=True)
class Mail:
    kind: str
    to: str
    subject: str
    html: str
    attachments: tuple[Attachment, ...] = ()


def _url(path: str) -> str:
    return f"{settings.APP_URL}{path}"


# vertex/src/components/portal/caseStages.ts's CASE_STAGE_LABELS (tests/test_emails.py reads it).
CASE_STAGE_LABELS = {
    "registration_document_submission": "Candidate Registration & Document Submission",
    "document_preparation_legalization": "Document Preparation, Translation & Legalization",
    "permit_application_submission": "Work Permit Application Submission",
    "permit_processing_followup": "Work Permit Processing & Government Follow-up",
    "permit_authorization_approved": "Work Permit & Work Authorization Approval",
    "original_documents_dispatch": "Dispatch of Original Documents",
    "partner_receives_permit": "Partner Receives Work Permit",
    "visa_interview_preparation": "Embassy Appointment & Visa Interview Preparation",
    "visa_interview_decision": "Embassy Interview & Visa Decision",
    "pre_departure_arrangements": "Pre-Departure & Flight Arrangements",
    "departure_arrival_support": "Departure & Arrival Support",
}


def _text(value: object) -> str:
    return str(value.value if isinstance(value, Enum) else value)


def friendly_status(status: object) -> str:
    """sendStatusUpdateEmail's `newStatus.replace("_", " ").toUpperCase()`: the first underscore only."""
    return _text(status).replace("_", " ", 1).upper()


def friendly_stage(stage: object) -> str:
    """The stage's label, else its words capitalised, as lib/email.ts did."""
    key = _text(stage)
    return CASE_STAGE_LABELS.get(key) or re.sub(r"\b\w", lambda m: m.group(0).upper(), key.replace("_", " "))


def locale_number(amount: float) -> str:
    """JavaScript's `amount.toLocaleString()` (en-US): grouped, at most three decimals."""
    rounded = Decimal(repr(float(amount))).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    return f"{rounded:,.3f}".rstrip("0").rstrip(".")


def fixed2(amount: float) -> str:
    """JavaScript's `amount.toFixed(2)`: of the float's exact value (1.005 is
    1.00499…, so "1.00"), a true tie rounding up."""
    return f"{Decimal(float(amount)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)}"


def js_round(value: float) -> int:
    """JavaScript's `Math.round`: a tie rounds up."""
    return math.floor(value + 0.5)


@dataclass(frozen=True)
class Filled:
    to: str | None  # None: a staff notification whose address isn't configured
    values: dict[str, str]
    variant: str | None = None  # a template key's ".variant"
    raw: dict[str, str] = field(default_factory=dict)  # HTML built here, from the template's parts
    attachments: tuple[Attachment, ...] = ()


def _plan_rows(n: BaseModel) -> str:
    """sendMilestonePaymentLinkEmail's milestonePlanRow, one per stage of the plan."""
    parts = TEMPLATES["milestone_payment_link"]["parts"]
    rows = []
    for i, stage in enumerate(n.stages):
        part = parts["row_current" if stage.id == n.current_stage_id else "row_upcoming"]
        rows.append(_fill(part, {
            "label": stage.label,
            "position": f"Stage {i + 1} of {len(n.stages)}",
            "percent": str(js_round(stage.percent)),
            "amount": locale_number(stage.amount),
            "triggerStageLabel": friendly_stage(stage.trigger_stage),
        }, escape=True))
    return "".join(rows)


def _milestone_link(n: BaseModel) -> Filled:
    current = next(stage for stage in n.stages if stage.id == n.current_stage_id)  # none: a render failure, as lib/email.ts threw
    return Filled(n.email, {
        "recipientName": n.recipient_name, "candidateName": n.candidate_name, "programmeTitle": n.programme_title,
        "paymentUrl": n.payment_url, "label": current.label, "amount": locale_number(current.amount),
    }, raw={"planRows": _plan_rows(n)})


def _consultation(n: BaseModel) -> Filled:
    # Name and phone rows are left out when empty, as lib/email.ts's docField did.
    variant = f"{'name' if n.full_name else 'no_name'}_{'phone' if n.phone else 'no_phone'}"
    return Filled(settings.CONSULTATION_NOTIFY_EMAIL, {
        "fullName": n.full_name or "", "email": n.email, "phone": n.phone or "", "amount": locale_number(n.amount), "currency": n.currency,
    }, variant)


def _receipt(n: BaseModel) -> Filled:
    pdf = Attachment(f"Receipt_{n.payment_id[:8]}.pdf", receipt_pdf(n), "application/pdf")
    return Filled(n.email, {"candidateName": n.full_name, "jobTitle": n.job_title, "amount": fixed2(n.amount)}, attachments=(pdf,))


def _commission(n: BaseModel) -> dict[str, str]:
    return {"agentName": n.agent_name, "candidateName": n.candidate_name, "amount": locale_number(n.amount), "currency": n.currency}


# Each kind this service sends: its recipient and its template's values.
VALUES: dict[str, Callable[[BaseModel], Filled]] = {
    "email_verification": lambda n: Filled(n.email, {"fullName": n.full_name, "verifyUrl": _url(f"/auth/verify-email?token={n.token}")}),
    "password_reset": lambda n: Filled(n.email, {"fullName": n.full_name, "resetUrl": _url(f"/auth/reset-password?token={n.token}")}),
    "account_setup": lambda n: Filled(n.email, {"name": n.full_name, "setupUrl": _url(f"/auth/register?setup={n.token}")}),
    "candidate_invite": lambda n: Filled(
        n.email, {"name": n.full_name, "registerUrl": _url(f"/auth/register?invite={sign_candidate_invite_token(n.candidate_id)}")},
    ),
    "referral_agent_application": lambda n: Filled(
        n.email, {"fullName": n.full_name, "verifyUrl": _url(f"/become-a-referral-agent/verify-email?token={n.token}")},
    ),
    # Batch 2: values only.
    "application_confirmation": lambda n: Filled(
        n.email, {"name": n.full_name, "jobTitle": n.job_title}, "account" if n.has_account else "no_account",
    ),
    "application_status": lambda n: Filled(
        n.email, {"name": n.full_name, "jobTitle": n.job_title, "friendlyStatus": friendly_status(n.status)},
    ),
    "candidate_approved": lambda n: Filled(n.email, {"name": n.full_name}),
    "candidate_message": lambda n: Filled(n.email, {"name": n.full_name, "viewUrl": _url(n.view_path)}),
    "case_stage": lambda n: Filled(n.email, {"name": n.full_name, "jobTitle": n.job_title, "friendlyStage": friendly_stage(n.stage)}),
    "partner_case_stage": lambda n: Filled(n.email, {
        "partnerName": n.partner_name, "candidateName": n.candidate_name, "jobTitle": n.job_title, "friendlyStage": friendly_stage(n.stage),
    }),
    "case_rejected": lambda n: Filled(n.email, {
        "recipientName": n.full_name, "candidateName": n.candidate_name, "jobTitle": n.job_title, "reason": n.reason,
    }),
    "partner_case_rejected": lambda n: Filled(n.email, {
        "partnerName": n.partner_name, "candidateName": n.candidate_name, "jobTitle": n.job_title, "reason": n.reason,
    }),
    "partner_candidate_submitted": lambda n: Filled(
        settings.PARTNER_SUBMISSION_NOTIFY_EMAIL, {"partnerName": n.partner_name, "candidateName": n.candidate_name},
    ),
    "partner_case_created": lambda n: Filled(n.email, {"partnerName": n.partner_name, "candidateName": n.candidate_name}),
    "partner_candidate_rejected": lambda n: Filled(
        n.email, {"partnerName": n.partner_name, "candidateName": n.candidate_name, "reason": n.reason},
    ),
    "referral_agent_admin_notification": lambda n: Filled(
        settings.REFERRAL_AGENT_NOTIFY_EMAIL, {"fullName": n.full_name, "country": n.country},
    ),
    "referral_agent_approved": lambda n: Filled(n.email, {
        "fullName": n.full_name, "referralCode": n.referral_code, "referralLink": _url(f"/apply?ref={n.referral_code}"),
    }),
    "referral_agent_rejected": lambda n: Filled(n.email, {"fullName": n.full_name, "reason": n.reason}),
    "referral_agent_suspended": lambda n: Filled(n.email, {"fullName": n.full_name, "reason": n.reason}),
    "referral_commission_earned": lambda n: Filled(n.agent_email, {**_commission(n), "milestone": _text(n.milestone)}),
    "referral_commission_approved": lambda n: Filled(n.email, _commission(n)),
    "referral_commission_paid": lambda n: Filled(n.email, _commission(n)),
    # Batch 3: the reminder, the payment plan, the staff's booking notice and the receipt.
    "case_reminder": lambda n: Filled(n.email, {
        "recipientName": n.recipient_name, "candidateName": n.candidate_name, "programmeTitle": n.programme_title, "message": n.message or "",
    }, f"{_text(n.channel)}_message" if n.message else _text(n.channel)),
    "milestone_payment_link": _milestone_link,
    "consultation_booked": _consultation,
    "payment_receipt": _receipt,
}
SENT_HERE = frozenset(VALUES)


def _fill(text: str, values: dict[str, str], *, escape: bool, raw: dict[str, str] | None = None) -> str:
    def one(match: re.Match[str]) -> str:
        if raw and match.group(1) in raw:
            return raw[match.group(1)]
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


def render(db: Session, key: str, values: dict[str, str], raw: dict[str, str] | None = None) -> tuple[str, str]:
    """The subject and HTML body for one template, with an admin's override.
    `raw` is HTML built here, put into the body as it is."""
    template = TEMPLATES[key]
    subject, body = _override(db, template["event"]) or (template["subject"] or "", template["html"] or "")
    values = {**values, "app_url": settings.APP_URL, "logo": LOGO, "year": str(utc_now_ms().year)}
    return _fill(subject, values, escape=False), _fill(body, values, escape=True, raw=raw)


def _in_background(send: Callable[[], None]) -> None:
    threading.Thread(target=send, daemon=True).start()


# Off the request, so a slow mail server never holds one. Tests send in line.
dispatch: Callable[[Callable[[], None]], None] = _in_background


def _send(mails: list[Mail]) -> None:
    for mail in mails:
        try:
            send_mail([mail.to], mail.subject, mail.html, html=True, attachments=mail.attachments)
        except Exception as err:  # noqa: BLE001 - one failure doesn't stop the rest
            log_event(logging.ERROR, "email.send_failed", kind=mail.kind, error=type(err).__name__)


def _mail(db: Session, notice: BaseModel) -> Mail | None:
    """One notice's email, or None when it isn't sent (logged by kind)."""
    kind = notice.kind
    try:
        filled = VALUES[kind](notice)
        if filled.to is None:
            log_event(logging.INFO, "email.recipient_not_configured", kind=kind)  # as lib/email.ts skipped it
            return None
        subject, body = render(db, f"{kind}.{filled.variant}" if filled.variant else kind, filled.values, filled.raw)
    except Exception as err:  # noqa: BLE001 - the write stands; the email is lost, as when sending fails
        log_event(logging.ERROR, "email.render_failed", kind=kind, error=type(err).__name__)
        return None
    return Mail(kind, filled.to, subject, body, filled.attachments)


def deliver(db: Session, notify: Sequence[BaseModel]) -> list[BaseModel]:
    """Sends the kinds this service sends, after the write has committed;
    returns the rest for the website."""
    kept = [notice for notice in notify if getattr(notice, "kind", None) not in SENT_HERE]
    mails = [mail for notice in notify if getattr(notice, "kind", None) in SENT_HERE and (mail := _mail(db, notice)) is not None]
    if mails:
        dispatch(lambda: _send(mails))
    return kept
