"""The public contact form and the emailed CIF (app/api/v1/public_forms.py,
reads handover R7b): FastAPI sends the email the request exists to send, in
the request, and a failure is the visitor's 502."""

from __future__ import annotations

import logging

import pytest

from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.enums import JobStatus
from app.models.jobs import Job
from app.services import emails
from tests.test_service_auth import SERVICE_SECRET, service_token

CONTACT = "/api/v1/public-forms/contact"
INTAKE = "/api/v1/public-forms/intake"


@pytest.fixture
def api(db, client, monkeypatch):
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET", SERVICE_SECRET)
    monkeypatch.setattr(settings, "SERVICE_AUTH_SECRET_PREVIOUS", None)
    monkeypatch.setattr(settings, "PUBLIC_FORMS_NOTIFY_EMAIL", "forms@test.invalid")
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def website() -> dict[str, str]:
    return {"X-Vertex-Service": service_token()}


@pytest.fixture
def job(db):
    j = Job(title="Care worker", country="Germany", city="Berlin", job_description="d", requirements="r")
    db.add(j)
    db.flush()
    return j


MESSAGE = {"name": "Sara", "email": "sara@test.invalid", "subject": "Partnership", "message": "We'd like to work with you <soon>."}


def test_a_contact_message_is_emailed_to_the_team(api, sent_mail):
    res = api.post(CONTACT, headers=website(), json={**MESSAGE, "registration_number": "LIC-9"})
    assert (res.status_code, res.json()) == (201, {"data": {"sent": True}})
    assert api.post(CONTACT, headers=website(), json=MESSAGE).status_code == 201
    with_number, without = sent_mail
    assert (with_number.to, with_number.reply_to, with_number.subject) == ("forms@test.invalid", "sara@test.invalid", "[Contact] Partnership")
    assert "We&#x27;d like to work with you &lt;soon&gt;." in with_number.html and "LIC-9" in with_number.html
    assert "Registration/Licence Number" not in without.html


def test_only_the_website_may_send_one(api, sent_mail):
    assert api.post(CONTACT, json=MESSAGE).status_code == 401
    assert sent_mail == []


def test_a_message_that_cant_go_is_the_visitors_502(api, sent_mail, monkeypatch, caplog):
    monkeypatch.setattr(settings, "PUBLIC_FORMS_NOTIFY_EMAIL", None)
    res = api.post(CONTACT, headers=website(), json=MESSAGE)
    assert (res.status_code, res.json()["error"]["message"]) == (502, "We couldn't send your message right now. Please try again shortly or email us directly.")
    monkeypatch.setattr(settings, "PUBLIC_FORMS_NOTIFY_EMAIL", "forms@test.invalid")

    def down(_mail):
        raise OSError("smtp down")

    monkeypatch.setattr(emails, "_transmit", down)
    with caplog.at_level(logging.ERROR, logger="vertex"):
        assert api.post(CONTACT, headers=website(), json=MESSAGE).status_code == 502
    assert [r.fields for r in caplog.records if r.getMessage() == "email.send_failed"] == [{"kind": "contact", "error": "OSError"}]


def form(job, **fields) -> dict:
    return {
        "job_id": job.id, "full_name": "Abebe Kebede", "email": "abebe@test.invalid", "phone": "+251 911", "nationality": "Ethiopian",
        "earliest_travel_date": "2027-01-15", "prior_eu_visa_applied": True, "prior_eu_visa_applied_details": "2024, Germany",
        "documents_available": ["Passport", "CV <latest>"], "current_location_country_name": "Ethiopia", "holds_schengen_visa": False,
        "available_for_embassy_appointment": True, "willing_to_start_within_30_days": False, "cover_letter": "Line one\nLine two",
    } | fields


def test_a_cif_is_emailed_as_a_document_then_confirmed(api, job, sent_mail):
    res = api.post(INTAKE, headers=website(), json=form(job))
    assert (res.status_code, res.json()) == (201, {"data": {"sent": True}})
    cif, confirmation = sent_mail
    assert (cif.to, cif.subject) == ("forms@test.invalid", "New CIF submission: Abebe Kebede — Care worker")
    for row in ("Berlin, Germany", "2027-01-15", "Yes — 2024, Germany", "+251 911", "✓ Passport", "✓ CV &lt;latest&gt;", "Line one\nLine two"):
        assert row in cif.html, row
    assert cif.html.count('">No</td>') == 2  # Schengen visa, starting within 30 days
    assert "{{" not in cif.html
    # Left out: no passport number, no answer on refusals, no contact channel.
    for label in ("Passport number", "Prior visa refusals", "Preferred contact channel"):
        assert label not in cif.html, label
    assert (confirmation.to, confirmation.subject) == ("abebe@test.invalid", "We've received your application — Vertex International")
    assert "Thank you, Abebe Kebede." in confirmation.html


def test_a_cif_without_documents_or_notes(api, job, sent_mail):
    api.post(INTAKE, headers=website(), json=form(job, documents_available=[], cover_letter=None))
    assert "None selected" in sent_mail[0].html and "Additional Notes" not in sent_mail[0].html


def test_a_cif_needs_a_job_still_taking_applications(api, db, job, sent_mail):
    res = api.post(INTAKE, headers=website(), json=form(job, job_id="c" + "x" * 24))
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Opportunity not found.")
    job.status = JobStatus.closed
    db.flush()
    res = api.post(INTAKE, headers=website(), json=form(job))
    assert (res.status_code, res.json()["error"]["message"]) == (404, "Applications for this programme are closed.")
    job.status, job.partner_only = JobStatus.active, True
    db.flush()
    assert api.post(INTAKE, headers=website(), json=form(job)).status_code == 404  # partner-only: not public
    assert sent_mail == []


def test_a_cif_that_cant_go_is_not_confirmed(api, job, sent_mail, monkeypatch):
    monkeypatch.setattr(settings, "PUBLIC_FORMS_NOTIFY_EMAIL", None)
    res = api.post(INTAKE, headers=website(), json=form(job))
    assert (res.status_code, res.json()["error"]["message"]) == (502, "We couldn't submit your application right now. Please try again shortly or contact us directly.")
    assert sent_mail == []
