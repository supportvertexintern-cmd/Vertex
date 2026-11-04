"""Reads handover R7c: the backup export, its catalogue, the record picker
and the candidates CSV (app/services/backup.py, app/api/v1/backup.py). The
checks of the website's server/backup/exporter.test.ts, against FastAPI,
plus the routes: who may export what, and that each export is on the audit
trail before its data leaves."""

import csv
import io
import zipfile
from datetime import datetime

import pytest
from sqlalchemy import text

from app.db.base import Base
from app.db.session import engine
from app.models.candidate import Application, Candidate
from app.models.cases import Case, CaseStageEvent
from app.models.enums import CandidateSource, CaseStage, CaseStatus, PartnerCandidateStatus as PS, Role
from app.models.partners import Partner, PartnerCandidate
from app.services import backup
from tests.test_case_reads import add_user, api, data, h, tag  # noqa: F401  (api is a fixture)

HR = backup.Actor("test-hr", Role.hr, "Test HR", "hr@test.local")


def unzip(blob: bytes) -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        return {name: z.read(name).decode("utf-8") for name in z.namelist()}


def table(text_: str) -> list[list[str]]:
    return list(csv.reader(io.StringIO(text_.lstrip("﻿"), newline="")))


def ids(text_: str) -> set[str]:
    header, *rows = table(text_)
    return {r[header.index("id")] for r in rows}


@pytest.fixture
def world(db):
    partner = Partner(name=f"Backup Agency {tag()}", partner_type="travel_agency", country_of_operation="Kenya", contact_name="C",
                      contact_email=f"ba-{tag()}@test.invalid", contact_phone="+1")
    db.add(partner)
    db.flush()
    draft = PartnerCandidate(partner_id=partner.id, status=PS.draft, full_name="Draft Backup")
    sent = PartnerCandidate(partner_id=partner.id, status=PS.submitted, full_name="Sent Backup")
    a = Candidate(full_name="=HYPERLINK(evil)", source=CandidateSource.recruiter_sourced, phone="+254 700 000000")
    b = Candidate(full_name="Bo Backup", created_at=datetime(2026, 1, 5))
    db.add_all([draft, sent, a, b])
    db.flush()
    application = Application(candidate_id=a.id)
    db.add(application)
    db.flush()
    active = Case(application_id=application.id, status=CaseStatus.active)
    db.add(active)
    db.flush()
    db.add(CaseStageEvent(case_id=active.id, stage=CaseStage.registration_document_submission))
    db.flush()
    return {k: v for k, v in locals().items() if k != "db"}


# --- the catalogue -------------------------------------------------------------------------


def test_every_table_is_in_a_category_or_never_exported():
    # So a new table can't silently drop out of full backups.
    categorised = {m for _, _, models in backup.CATEGORIES for m in models}
    assert sorted(set(Base.metadata.tables) - categorised - set(backup.NEVER_EXPORTED)) == []


def test_who_gets_which_tables():
    exportable = set(Base.metadata.tables) - set(backup.NEVER_EXPORTED)
    for role in (Role.admin, Role.director):
        assert set(backup.allowed_models(role)) == exportable
        assert not set(backup.allowed_models(role)) & set(backup.NEVER_EXPORTED)
    hr = backup.allowed_models(Role.hr)
    assert {"Candidate", "PartnerCandidate", "Case", "Document", "User"} <= set(hr)
    for restricted in ("AuditLog", "ReferralAgent", "SystemSetting", "StaffScorecard", "EmailTemplate"):
        assert restricted not in hr
    assert backup.allowed_models(Role.regional_recruiter) == [] and backup.allowed_models(Role.partner) == []


def test_never_credential_columns():
    names = [f.name for f in backup.fields(backup.mapper("User"))]
    assert "password_hash" not in names and "google_id" not in names and "email" in names


def test_relationships_only_to_exportable_tables_both_ways():
    catalog = backup.describe(Role.hr)
    allowed = set(backup.allowed_models(Role.hr))
    assert all(r["model"] in allowed for t in catalog["tables"] for r in t["relations"])
    user = next(t for t in catalog["tables"] if t["name"] == "User")
    assert "Report" not in {r["model"] for r in user["relations"]}

    def link(model, name):
        rel = next(r for r in backup.relations(backup.mapper(model)) if r.key == name)
        return backup.link(rel)

    assert link("Case", "application") == backup.Link("application_id", "id")
    assert link("Case", "stage_events") == backup.Link("id", "case_id")
    assert link("User", "direct_reports") == backup.Link("id", "supervisor_id")
    assert link("User", "supervisor") == backup.Link("supervisor_id", "id")
    status = next(f for f in next(t for t in catalog["tables"] if t["name"] == "Case")["fields"] if f["name"] == "status")
    assert (status["type"], status["enumValues"]) == ("enum", ["active", "rejected"])


# --- the export ------------------------------------------------------------------------------


def test_a_full_backup_for_hr(db, world):
    result = backup.build_export(db, HR, backup.FullRequest(mode="full"))
    assert result.filename.startswith("vertex-full-backup_") and result.manifest["export_type"] == "full_backup"
    files = unzip(result.zip)
    assert all(f"{m}.csv" in files for m in backup.allowed_models(Role.hr))
    assert "AuditLog.csv" not in files and "RefreshToken.csv" not in files
    assert "FULL BACKUP" in files["README.txt"] and "password_hash" not in files["User.csv"]
    submissions = ids(files["PartnerCandidate.csv"])
    assert world["sent"].id in submissions and world["draft"].id not in submissions  # no drafts for HR
    assert {world["a"].id, world["b"].id} <= ids(files["Candidate.csv"])
    # Formula injection is neutralised in text; a phone number is left alone.
    header, *rows = table(files["Candidate.csv"])
    mine = next(r for r in rows if r[header.index("id")] == world["a"].id)
    assert (mine[header.index("full_name")], mine[header.index("phone")]) == ("'=HYPERLINK(evil)", "+254 700 000000")
    assert files["Candidate.csv"].startswith("﻿") and "\r\n" in files["Candidate.csv"]


def test_admin_gets_drafts_and_every_table_reads(db, world):
    admin = backup.Actor("a", Role.admin, None, None)
    files = unzip(backup.build_export(db, admin, backup.FullRequest(mode="full")).zip)
    assert world["draft"].id in ids(files["PartnerCandidate.csv"])
    assert len([n for n in files if n.endswith(".csv") and n != "relationships.csv"]) == len(backup.allowed_models(Role.admin))


def test_a_custom_export_with_filters_columns_and_related_tables(db, world):
    request = backup.CustomRequest.model_validate({"mode": "custom", "sections": [{
        "title": "Active cases",
        "root": {"model": "Case", "fields": ["current_stage", "application_id", "id"], "relations": {
            "application": {"model": "Application", "relations": {"candidate": {"model": "Candidate", "fields": ["id", "full_name"]}}},
            "stage_events": {"model": "CaseStageEvent"},
        }},
        "filters": {"enums": {"status": ["active"]}, "ids": [world["active"].id]},
    }]})
    result = backup.build_export(db, HR, request)
    files = unzip(result.zip)
    assert "NOT a complete backup" in files["README.txt"]
    cases = table(files["01-active-cases/Case.csv"])
    assert cases[0] == ["id", "application_id", "current_stage"]  # the model's order, chosen columns only
    assert [r[0] for r in cases[1:]] == [world["active"].id]
    assert table(files["01-active-cases/Candidate.csv"]) == [["id", "full_name"], [world["a"].id, "'=HYPERLINK(evil)"]]
    assert len(table(files["01-active-cases/CaseStageEvent.csv"])) == 2
    assert "Case,application_id,Application,id" in files["01-active-cases/relationships.csv"]


def test_specific_records_and_a_date_range(db, world):
    request = backup.CustomRequest.model_validate({"mode": "custom", "sections": [
        {"title": "Picked", "root": {"model": "Candidate"}, "filters": {"ids": [world["a"].id, world["b"].id]}},
        {"title": "Future", "root": {"model": "Candidate"}, "filters": {"dateField": "created_at", "start": "2999-01-01"}},
    ]})
    files = unzip(backup.build_export(db, HR, request).zip)
    assert ids(files["01-picked/Candidate.csv"]) == {world["a"].id, world["b"].id}
    assert len(table(files["02-future/Candidate.csv"])) == 1  # the header only


@pytest.mark.parametrize("root,filters", [
    ({"model": "AuditLog"}, None),
    ({"model": "User", "fields": ["password_hash"]}, None),
    ({"model": "User", "relations": {"submitted_reports": {"model": "Report"}}}, None),
    ({"model": "Case", "relations": {"application": {"model": "Candidate"}}}, None),
    ({"model": "Case"}, {"enums": {"status": ["bogus"]}}),
    ({"model": "Case"}, {"start": "2026-01-01"}),
])
def test_outside_the_catalogue_is_refused(db, root, filters):
    request = backup.CustomRequest.model_validate({"mode": "custom", "sections": [{"title": "x", "root": root, "filters": filters}]})
    with pytest.raises(backup.ExportValidationError):
        backup.build_export(db, HR, request)


# --- the routes ---------------------------------------------------------------------------------


def audit_rows(entity_type: str, actor: str) -> list[dict]:
    with engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(
            text('SELECT * FROM "AuditLog" WHERE action = \'export\' AND entity_type = :t AND actor_id = :a'), {"t": entity_type, "a": actor})]


@pytest.mark.parametrize("role", list(Role))
def test_who_may_use_the_backup_routes(api, db, role):  # noqa: F811
    hdr = h(db, add_user(db, role))
    expected = 200 if role in backup.BACKUP_ROLES else 403
    assert api.get("/api/v1/backup/catalog", headers=hdr).status_code == expected
    csv_expected = 200 if role in (Role.admin, Role.operations_team, Role.operations_director, Role.director, Role.hr) else 403
    assert api.get("/api/v1/backup/candidates-csv", params={"start": "2999-01-01"}, headers=hdr).status_code == csv_expected


def test_the_export_route_answers_a_zip_and_audits_it(api, db, world):  # noqa: F811
    user = add_user(db, Role.hr)
    res = api.post("/api/v1/backup/export", headers=h(db, user), json={"mode": "full"})
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip" and "vertex-full-backup_" in res.headers["content-disposition"]
    manifest = unzip(res.content)["manifest.json"]
    assert user.id in manifest
    [row] = audit_rows("DataExport", user.id)
    assert (row["after"]["export_type"], row["after"]["role"]) == ("full_backup", "hr")
    bad = api.post("/api/v1/backup/export", headers=h(db, user), json={"mode": "custom", "sections": [{"title": "x", "root": {"model": "AuditLog"}}]})
    assert (bad.status_code, bad.json()["error"]["message"]) == (400, 'You don\'t have access to export "AuditLog".')
    assert api.post("/api/v1/backup/export", headers=h(db, user), json={"mode": "weekly"}).status_code == 400


def test_an_export_that_cant_be_recorded_isnt_made(api, db, world, monkeypatch):  # noqa: F811
    def broken(*_args, **_kwargs):
        raise RuntimeError("audit store unavailable")

    monkeypatch.setattr("app.api.v1.backup.append_event", broken)
    res = api.post("/api/v1/backup/export", headers=h(db, add_user(db, Role.admin)), json={"mode": "full"})
    assert (res.status_code, res.json()["error"]["code"]) == (503, "audit_unavailable")


def test_the_record_picker(api, db, world):  # noqa: F811
    user = add_user(db, Role.hr)
    found = data(api.get("/api/v1/backup/records", params={"model": "Case", "q": world["a"].full_name.lower()}, headers=h(db, user)))
    assert [(r["id"], r["label"]) for r in found["records"]] == [(world["active"].id, world["a"].full_name)]
    by_id = data(api.get("/api/v1/backup/records", params={"model": "PartnerCandidate", "q": world["draft"].id}, headers=h(db, user)))
    assert by_id["records"] == []  # HR never sees a draft
    refused = api.get("/api/v1/backup/records", params={"model": "AuditLog"}, headers=h(db, user))
    assert (refused.status_code, refused.json()["error"]["message"]) == (403, "Table not available for export.")
    # Who looked up which table, never the search text.
    rows = audit_rows("Case", user.id)
    assert rows and rows[0]["after"] == {"purpose": "backup_record_picker", "rows": 1, "searched": True}


def test_the_candidates_csv(api, db, world):  # noqa: F811
    user = add_user(db, Role.operations_team)
    res = api.get("/api/v1/backup/candidates-csv", params={"start": "2026-01-05", "end": "2026-01-05"}, headers=h(db, user))
    assert res.status_code == 200, res.text
    assert res.headers["content-disposition"] == 'attachment; filename="candidates_2026-01-05_to_2026-01-05.csv"'
    rows = list(csv.reader(io.StringIO(res.text)))
    assert rows[0][:3] == ["ID", "Name", "Email"] and len(rows[0]) == 49
    assert world["b"].id in {r[0] for r in rows[1:]} and world["a"].id not in {r[0] for r in rows[1:]}
    [row] = audit_rows("CandidateExport", user.id)
    assert row["after"]["filters"] == {"start": "2026-01-05", "end": "2026-01-05"}
    assert api.get("/api/v1/backup/candidates-csv", params={"start": "soon"}, headers=h(db, user)).status_code == 422
