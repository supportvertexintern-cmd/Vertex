"""The emails FastAPI sends (reads handover R7b, app/services/emails.py): its
templates are lib/email.ts's (the website's email-templates.test.ts pins
them), filled with escaped values, an admin's override applied. Every kind
is sent here since R7b's third batch (tests/test_notices.py)."""

from __future__ import annotations

import logging
import re
import typing
from enum import Enum

import jwt
import pytest
from pydantic import BaseModel

from app.api import notices
from app.api.notices import (
    AccountSetupEmail,
    ApplicationConfirmationEmail,
    CaseReminderEmail,
    ConsultationBookedEmail,
    InviteEmail,
    MilestonePaymentLinkEmail,
    MilestonePlanStage,
    PartnerSubmittedEmail,
    PasswordResetEmail,
    PaymentReceiptEmail,
    ReferralAgentApplicationEmail,
    VerificationEmail,
)
from app.core.clock import utc_now_ms
from app.core.config import BASE_DIR, settings
from app.core.tokens import CANDIDATE_INVITE_TTL_SECONDS, verify_candidate_invite_token
from app.models.reference import EmailTemplate
from app.services import emails, receipt
from tests.mail import link, token

SEND = emails._send  # before the sent_mail fixture replaces it


def test_every_kind_sent_here_has_its_template_and_values():
    assert {key.split(".")[0] for key in emails.TEMPLATES} == emails.SENT_HERE == set(emails.VALUES)
    for key, template in emails.TEMPLATES.items():
        if key != "payment_receipt":  # lib/invoice.ts's own plain email
            assert "{{logo}}" in template["html"] and "{{year}}" in template["html"], key


def _sample(model):
    """A notice of this kind, every field a plausible value."""
    def value(annotation):
        if annotation is bool:
            return True
        if annotation is float:
            return 1234.5
        if isinstance(annotation, type) and issubclass(annotation, Enum):
            return next(iter(annotation))
        return "Abebe"
    fields = {name: value(field.annotation) for name, field in model.model_fields.items() if name != "kind"}
    if "email" in fields:
        fields["email"] = "a@test.invalid"
    if "view_path" in fields:
        fields["view_path"] = "/dashboard"
    if "date" in fields:
        fields["date"] = "2026-11-06T10:00:00.000Z"
    if "stages" in fields:
        fields["stages"] = [MilestonePlanStage(id="Abebe", label="Deposit", percent=40, amount=400, trigger_stage="visa_interview_decision")]
    return model(**fields)


SENT_MODELS = [m for m in typing.get_args(typing.get_args(notices.Notice)[0]) if m.model_fields["kind"].default in emails.SENT_HERE]


@pytest.mark.parametrize("model", SENT_MODELS, ids=lambda m: m.model_fields["kind"].default)
def test_every_kind_renders_completely(db, sent_mail, monkeypatch, model):
    monkeypatch.setattr(settings, "PARTNER_SUBMISSION_NOTIFY_EMAIL", "staff@test.invalid")
    monkeypatch.setattr(settings, "REFERRAL_AGENT_NOTIFY_EMAIL", "staff@test.invalid")
    monkeypatch.setattr(settings, "CONSULTATION_NOTIFY_EMAIL", "staff@test.invalid")
    notice = _sample(model)
    assert emails.deliver(db, [notice]) == []
    [mail] = sent_mail
    assert mail.to in {"a@test.invalid", "Abebe", "staff@test.invalid"}  # Abebe: a commission's agent_email
    assert not re.findall(r"\{\{\w+\}\}", mail.subject + mail.html), notice.kind
    if notice.kind != "payment_receipt":
        assert emails.LOGO in mail.html and f"© {utc_now_ms().year} " in mail.html


def test_the_confirmation_has_a_dashboard_link_only_with_an_account(db, sent_mail):
    base = {"email": "a@test.invalid", "full_name": "Abebe", "job_title": "Care worker"}
    emails.deliver(db, [ApplicationConfirmationEmail(**base, has_account=True), ApplicationConfirmationEmail(**base, has_account=False)])
    account, no_account = sent_mail
    assert link(account) == f"{settings.APP_URL}/dashboard"
    assert "href=" not in no_account.html and "Care worker" in no_account.html
    assert account.subject == no_account.subject == "Application Received: Care worker"


def test_a_staff_notification_needs_its_address(db, sent_mail, monkeypatch, caplog):
    notice = PartnerSubmittedEmail(partner_name="Bridge", candidate_name="Juma")
    monkeypatch.setattr(settings, "PARTNER_SUBMISSION_NOTIFY_EMAIL", None)
    with caplog.at_level(logging.INFO, logger="vertex"):
        assert emails.deliver(db, [notice]) == []
    assert sent_mail == []
    assert [r.fields for r in caplog.records if r.getMessage() == "email.recipient_not_configured"] == [{"kind": "partner_candidate_submitted"}]
    monkeypatch.setattr(settings, "PARTNER_SUBMISSION_NOTIFY_EMAIL", "staff@test.invalid")
    emails.deliver(db, [notice])
    assert [(m.to, m.subject) for m in sent_mail] == [("staff@test.invalid", "New partner candidate: Juma")]


def test_the_computed_values_are_lib_email_ts_own():
    assert emails.friendly_status("under_review") == "UNDER REVIEW"
    assert emails.friendly_status("offer_made_final") == "OFFER MADE_FINAL"  # JavaScript's replace: the first only
    assert emails.friendly_stage("visa_interview_decision") == "Embassy Interview & Visa Decision"
    assert emails.friendly_stage("some_new_stage") == "Some New Stage"
    assert [emails.locale_number(x) for x in (1500, 1500.5, 1234567.891, 0.1 + 0.2, 2.0005, 12)] == [
        "1,500", "1,500.5", "1,234,567.891", "0.3", "2.001", "12",
    ]
    assert [emails.fixed2(x) for x in (49.5, 0.125, 1.005, 1234567)] == ["49.50", "0.13", "1.00", "1234567.00"]  # toFixed(2): no grouping
    assert [emails.js_round(x) for x in (33.5, 33.4, 66.67, -0.5)] == [34, 33, 67, 0]


def test_a_reminder_by_channel_with_its_message_only_if_there_is_one(db, sent_mail):
    base = {"email": "a@test.invalid", "recipient_name": "Pat", "candidate_name": "Abebe", "programme_title": "Care worker"}
    emails.deliver(db, [
        CaseReminderEmail(**base, channel="document", message=None),
        CaseReminderEmail(**base, channel="payment", message="Please <b>pay</b>"),
        CaseReminderEmail(**base, channel="payment", message=""),
    ])
    document, payment, blank = sent_mail
    assert document.subject == "Documents needed to keep your case moving — Vertex International"
    assert payment.subject == blank.subject == "A payment is due on your case — Vertex International"
    assert "Please &lt;b&gt;pay&lt;/b&gt;" in payment.html and "&lt;b&gt;" not in blank.html
    assert link(document) == f"{settings.APP_URL}/dashboard"


def test_the_payment_plan_has_a_row_a_stage_escaped_and_the_current_one_due(db, sent_mail):
    stages = [
        MilestonePlanStage(id="s1", label="Deposit", percent=33.5, amount=1500, trigger_stage="registration_document_submission"),
        MilestonePlanStage(id="s2", label="<b>Visa</b>", percent=66.5, amount=2999.9996, trigger_stage="visa_interview_decision"),
    ]
    notice = MilestonePaymentLinkEmail(
        email="a@test.invalid", recipient_name="Pat", candidate_name="Abebe", programme_title="Care", payment_url="https://buy.stripe.test/1",
        current_stage_id="s2", stages=stages,
    )
    emails.deliver(db, [notice])
    [mail] = sent_mail
    assert mail.subject == "<b>Visa</b> due for Abebe — Vertex International"  # a plain-text subject
    assert "&lt;b&gt;Visa&lt;/b&gt; — 3,000 GBP" in mail.html and "<b>Visa</b>" not in mail.html
    assert "Stage 1 of 2 · 34%" in mail.html and "Stage 2 of 2 · 67%" in mail.html and "1,500 GBP" in mail.html
    assert mail.html.index("Upcoming") < mail.html.index("Due now")  # the second row is the current one
    assert "Due from: Candidate Registration &amp; Document Submission" in mail.html


def test_a_plan_without_its_current_stage_isnt_sent(db, sent_mail, caplog):
    stage = MilestonePlanStage(id="s1", label="Deposit", percent=40, amount=400, trigger_stage="visa_interview_decision")
    notice = MilestonePaymentLinkEmail(
        email="a@test.invalid", recipient_name="P", candidate_name="A", programme_title="C", payment_url="u", current_stage_id="gone", stages=[stage],
    )
    with caplog.at_level(logging.ERROR, logger="vertex"):
        emails.deliver(db, [notice])
    assert sent_mail == [] and [r.fields["kind"] for r in caplog.records if r.getMessage() == "email.render_failed"] == ["milestone_payment_link"]


def test_a_booking_leaves_out_what_stripe_didnt_give(db, sent_mail, monkeypatch, caplog):
    monkeypatch.setattr(settings, "CONSULTATION_NOTIFY_EMAIL", None)
    full = ConsultationBookedEmail(full_name="Sara", email="s@test.invalid", phone="+251 911", amount=1500, currency="EUR")
    with caplog.at_level(logging.INFO, logger="vertex"):
        emails.deliver(db, [full])
    assert sent_mail == [] and any(r.getMessage() == "email.recipient_not_configured" for r in caplog.records)
    monkeypatch.setattr(settings, "CONSULTATION_NOTIFY_EMAIL", "staff@test.invalid")
    emails.deliver(db, [full, full.model_copy(update={"full_name": None, "phone": None})])
    named, anonymous = sent_mail
    assert (named.to, named.subject) == ("staff@test.invalid", "New consultation booking — Sara")
    assert "1,500 EUR — Pathway Consultation" in named.html and "+251 911" in named.html and ">Phone<" in named.html
    assert anonymous.subject == "New consultation booking — s@test.invalid"
    assert ">Name<" not in anonymous.html and ">Phone<" not in anonymous.html


def test_the_receipt_carries_its_pdf(db, sent_mail):
    notice = PaymentReceiptEmail(
        payment_id="pay12345678", full_name="Ann Lee", email="ann@test.invalid", job_title="Orchard", amount=50, transaction_id="txn_1",
        date="2026-11-01T22:05:09.000Z",
    )
    emails.deliver(db, [notice, notice.model_copy(update={"full_name": "አበበ Ann"})])  # beyond Latin-1: "?", not a failure
    first, second = sent_mail
    assert (first.to, first.subject) == ("ann@test.invalid", "Payment Receipt - Vertex International")
    assert "Hello Ann Lee," in first.html and "<strong>$50.00</strong>" in first.html
    [pdf] = first.attachments
    assert (pdf.filename, pdf.content_type, pdf.content[:5]) == ("Receipt_pay12345.pdf", "application/pdf", b"%PDF-")
    assert second.attachments[0].content[:5] == b"%PDF-"
    assert receipt._when(notice.date) == "11/1/2026, 10:05:09 PM UTC"
    assert receipt._when("2026-01-02T00:00:00.000Z") == "1/2/2026, 12:00:00 AM UTC"


def test_the_stage_labels_are_the_websites():
    source = (BASE_DIR.parent / "vertex" / "src" / "components" / "portal" / "caseStages.ts").read_text(encoding="utf-8")
    block = re.search(r"export const CASE_STAGE_LABELS[^=]*= \{(.*?)\n\};", source, re.S).group(1)
    assert dict(re.findall(r'^\s*(\w+): "([^"]*)",', block, re.M)) == emails.CASE_STAGE_LABELS


@pytest.mark.parametrize("notice", [
    VerificationEmail(email="a@test.invalid", full_name="Abebe", token="t.k.n"),
    PasswordResetEmail(email="a@test.invalid", full_name="Abebe", token="t.k.n"),
    AccountSetupEmail(email="a@test.invalid", full_name="Abebe", token="t.k.n"),
    InviteEmail(candidate_id="c1", email="a@test.invalid", full_name="Abebe"),
    ReferralAgentApplicationEmail(email="a@test.invalid", full_name="Abebe", token="t.k.n"),
])
def test_each_template_is_filled_completely(db, sent_mail, notice):
    assert emails.deliver(db, [notice]) == []
    [mail] = sent_mail
    assert (mail.kind, mail.to) == (notice.kind, "a@test.invalid")
    assert not re.findall(r"\{\{\w+\}\}", mail.subject + mail.html)
    assert "Abebe" in mail.html and emails.LOGO in mail.html and f"© {utc_now_ms().year} " in mail.html
    assert link(mail).startswith(settings.APP_URL + "/")


def test_values_are_escaped_into_the_body_not_the_subject(db, sent_mail):
    emails.deliver(db, [VerificationEmail(email="a@test.invalid", full_name='<img src=x onerror="alert(1)">', token='x"y')])
    [mail] = sent_mail
    assert "<img src=x" not in mail.html and "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in mail.html
    assert "token=x&quot;y" in mail.html and token(mail) == 'x"y'


def test_an_admins_override_is_used_with_the_same_placeholders(db, sent_mail):
    db.merge(EmailTemplate(event="reset_password", subject="Reset for {{fullName}}", body_html='<p>Hi {{fullName}}</p><a href="{{resetUrl}}">go</a> {{unknown}}'))
    db.flush()
    emails.deliver(db, [PasswordResetEmail(email="a@test.invalid", full_name="Abebe & Co", token="tok")])
    [mail] = sent_mail
    assert mail.subject == "Reset for Abebe & Co"  # plain text: not escaped
    assert mail.html == f'<p>Hi Abebe &amp; Co</p><a href="{settings.APP_URL}/auth/reset-password?token=tok">go</a> {{{{unknown}}}}'


def test_the_invite_link_is_one_the_registration_accepts(db, sent_mail):
    emails.deliver(db, [InviteEmail(candidate_id="cand-1", email="a@test.invalid", full_name="Abebe")])
    invite = token(sent_mail[0])
    assert verify_candidate_invite_token(invite) == "cand-1"
    claims = jwt.decode(invite, options={"verify_signature": False})
    assert (claims["exp"] - claims["iat"], claims["type"]) == (CANDIDATE_INVITE_TTL_SECONDS, "candidate_invite")


class _Unknown(BaseModel):
    kind: str = "no_such_email"


def test_a_kind_not_sent_here_is_returned_not_dropped(db, sent_mail):
    first, second = _Unknown(), _Unknown(kind="another")
    kept = emails.deliver(db, [first, AccountSetupEmail(email="a@test.invalid", full_name="A", token="t"), second])
    assert kept == [first, second]
    assert [m.kind for m in sent_mail] == ["account_setup"]


def test_a_failure_is_logged_by_kind_without_the_link(db, sent_mail, monkeypatch, caplog):
    def broken(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(emails, "render", broken)
    with caplog.at_level(logging.ERROR, logger="vertex"):
        kept = emails.deliver(db, [VerificationEmail(email="a@test.invalid", full_name="A", token="secret-link-token")])
    assert (kept, sent_mail) == ([], [])
    [record] = [r for r in caplog.records if r.getMessage() == "email.render_failed"]
    assert record.fields == {"kind": "email_verification", "error": "RuntimeError"}


def test_one_send_failing_doesnt_stop_the_rest(monkeypatch, caplog):
    tried = []

    def send_mail(to, subject, body, *, html=False, attachments=()):
        tried.append(to[0])
        if to[0] == "a@test.invalid":
            raise OSError("smtp down")
        return True

    monkeypatch.setattr(emails, "send_mail", send_mail)
    with caplog.at_level(logging.ERROR, logger="vertex"):
        SEND([emails.Mail("password_reset", "a@test.invalid", "s", "h"), emails.Mail("account_setup", "b@test.invalid", "s", "h")])
    assert tried == ["a@test.invalid", "b@test.invalid"]
    [record] = [r for r in caplog.records if r.getMessage() == "email.send_failed"]
    assert record.fields == {"kind": "password_reset", "error": "OSError"}
