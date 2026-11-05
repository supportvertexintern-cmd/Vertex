"""The emails FastAPI sends (reads handover R7b, app/services/emails.py): its
templates are lib/email.ts's (the website's email-templates.test.ts pins
them), filled with escaped values, an admin's override applied; the kinds it
doesn't send yet stay in `notify` for the website."""

from __future__ import annotations

import logging
import re

import jwt
import pytest

from app.api.notices import (
    AccountSetupEmail,
    CandidateApprovedEmail,
    InviteEmail,
    PasswordResetEmail,
    ReferralAgentApplicationEmail,
    VerificationEmail,
)
from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.tokens import CANDIDATE_INVITE_TTL_SECONDS, verify_candidate_invite_token
from app.models.reference import EmailTemplate
from app.services import emails
from tests.mail import link, token

SEND = emails._send  # before the sent_mail fixture replaces it


def test_every_kind_sent_here_has_its_template_and_values():
    assert set(emails.TEMPLATES) == emails.SENT_HERE == set(emails.VALUES)
    for kind, template in emails.TEMPLATES.items():
        assert "{{logo}}" in template["html"] and "{{year}}" in template["html"], kind


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


def test_the_kinds_not_sent_here_stay_for_the_website_in_order(db, sent_mail):
    first, second = CandidateApprovedEmail(email="b@test.invalid", full_name="B"), CandidateApprovedEmail(email="c@test.invalid", full_name="C")
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

    def send_mail(to, subject, body, *, html=False):
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
