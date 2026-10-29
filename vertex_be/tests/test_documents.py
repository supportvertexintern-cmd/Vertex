"""Document writes (pipeline handover step 6.3) answer as Next.js's
POST /api/upload, PATCH /api/documents/[id]/verify and
assertDocumentReadable do: the same roles, access rules, file checks,
messages and status codes. The file goes to S3-compatible storage (moto
here, MinIO on the stacks) after a ClamAV scan (a fake clamd here)."""

import re
import secrets
import socketserver
import threading
import time
from types import SimpleNamespace

import boto3
import jwt
import pytest
from moto import mock_aws
from sqlalchemy import select, text

from app.api.v1 import documents as module
from app.api.v1.documents import VERIFIERS
from app.core.config import BASE_DIR, settings
from app.core.tokens import key_for
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Application, Candidate, Document
from app.models.enums import CandidateLifecycleStatus, PartnerCandidateStatus, PartnerType, Role, VerificationStatus
from app.models.identity import Country, Region, User
from app.models.partners import Partner, PartnerCandidate
from app.models.reference import DocumentRequirementType
from app.services import malware_scan, storage
from app.services.storage import StorageNotConfigured, detect_file_type, resolve_storage_config
from tests.node_session_vectors import SECRET
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)
from tests.test_service_auth import SERVICE_SECRET, service_token

WEB = BASE_DIR.parent / "vertex" / "src"
URL = "/api/v1/documents"
BUCKET = "vertex-test"
PDF = b"%PDF-1.7\n" + b"x" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 100
EICAR = "Win.Test.EICAR_HDB-1"


# --- the fakes ---------------------------------------------------------------


class FakeClamd:
    """Answers every INSTREAM with `reply` (None: the scanner is down)."""

    def __init__(self) -> None:
        self.reply: str | None = "stream: OK"
        self.scanned = 0
        fake = self

        class Handler(socketserver.BaseRequestHandler):
            def handle(self) -> None:
                received = b""
                while not received.endswith(b"\0\0\0\0"):
                    part = self.request.recv(65536)
                    if not part:
                        return
                    received += part
                fake.scanned += 1
                self.request.sendall(f"{fake.reply}\0".encode())

        self.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


@pytest.fixture(scope="module")
def clamd():
    fake = FakeClamd()
    yield fake
    fake.server.shutdown()


@pytest.fixture(autouse=True)
def stack(monkeypatch, clamd):
    """The switch on, a bucket, the scanner up and answering clean."""
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", True)
    for name, value in {
        "S3_ENDPOINT": None, "S3_REGION": "eu-central-1", "S3_BUCKET": BUCKET,
        "S3_ACCESS_KEY_ID": "test", "S3_SECRET_ACCESS_KEY": "test",
        "CLAMD_HOST": "127.0.0.1", "CLAMD_PORT": clamd.port, "MAX_FILE_SIZE_MB": 1,
        "SERVICE_AUTH_SECRET": SERVICE_SECRET, "SERVICE_AUTH_SECRET_PREVIOUS": None,
    }.items():
        monkeypatch.setattr(settings, name, value)
    clamd.reply = "stream: OK"
    storage._client.cache_clear()
    with mock_aws():
        boto3.client("s3", region_name="eu-central-1").create_bucket(Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "eu-central-1"})
        yield
    storage._client.cache_clear()


def stored() -> set[str]:
    listing = boto3.client("s3", region_name="eu-central-1").list_objects_v2(Bucket=BUCKET)
    return {o["Key"] for o in listing.get("Contents", [])}


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def person(db, role: Role, **fields) -> tuple[User, dict[str, str]]:
    u = User(full_name=f"{role.value} {secrets.token_hex(2)}", email=f"doc-{secrets.token_hex(4)}@test.invalid", role=role, **fields)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def world(db):
    region = Region(name=f"Doc region {secrets.token_hex(3)}")
    db.add(region)
    db.flush()
    home = Country(name=f"Doc home {secrets.token_hex(3)}", region_id=region.id)
    away = Country(name=f"Doc away {secrets.token_hex(3)}", region_id=region.id)
    passport = DocumentRequirementType(key=f"passport_{secrets.token_hex(3)}", label="Passport", is_universal=True)
    other = db.scalar(select(DocumentRequirementType).where(DocumentRequirementType.key == "other"))
    if other is None:
        other = DocumentRequirementType(key="other", label="Other Document")
    db.add_all([home, away, passport, other])
    db.flush()
    recruiter, rec = person(db, Role.regional_recruiter, assigned_country_id=home.id)
    _, sup = person(db, Role.country_supervisor, assigned_country_id=home.id)
    owner, own = person(db, Role.candidate)
    _, hr = person(db, Role.hr)
    mine = Candidate(full_name="Uploader", user_id=owner.id, recruiter_id=recruiter.id, country_id=home.id, lifecycle_status=CandidateLifecycleStatus.guided_to_apply)
    elsewhere = Candidate(full_name="Elsewhere", country_id=away.id)
    db.add_all([mine, elsewhere])
    db.flush()
    db.add(Application(candidate_id=mine.id))
    db.flush()
    return SimpleNamespace(home=home, passport=passport.key, recruiter=recruiter, rec=rec, sup=sup, owner=owner, own=own, hr=hr, mine=mine, elsewhere=elsewhere)


def upload(api, headers, document_type, *, data=PDF, mime="application/pdf", label=None, **query):
    files = {"file": ("scan.pdf", data, mime)}
    form = {"label": label} if label is not None else None
    return api.post(URL, headers=headers, params={"type": document_type, **query}, files=files, data=form)


def error(res) -> dict:
    return res.json()["error"]


def required_universal_types(db) -> list[str]:
    return list(db.scalars(select(DocumentRequirementType.key).where(DocumentRequirementType.is_universal.is_(True))))


# --- drift -------------------------------------------------------------------


def test_the_verifiers_match_next_js():
    # The upload rules (who uploads for whom, file types, messages) are only
    # FastAPI's since the switch (step 6.7): the website passes uploads on.
    verify_ts = (WEB / "app" / "api" / "documents" / "[id]" / "verify" / "route.ts").read_text(encoding="utf-8")
    verifiers = re.search(r"const VERIFIER_ROLES: Role\[\] = \[(.*?)\]", verify_ts).group(1)
    assert set(re.findall(r'"(\w+)"', verifiers)) == {r.value for r in VERIFIERS}


def test_the_bytes_decide_the_type():
    assert detect_file_type(PDF) == ("application/pdf", "pdf")
    assert detect_file_type(b"\xff\xd8\xff\xe0rest") == ("image/jpeg", "jpg")
    assert detect_file_type(PNG) == ("image/png", "png")
    assert detect_file_type(b"MZ\x90\x00") is None


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ({"S3_ENDPOINT": "http://minio:9000", "S3_BUCKET": "b", "S3_ACCESS_KEY_ID": "k", "S3_SECRET_ACCESS_KEY": "s"}, ("b", "us-east-1", "http://minio:9000", True)),
        ({"S3_REGION": "eu-central-1", "S3_BUCKET": "b", "S3_ACCESS_KEY_ID": "k", "S3_SECRET_ACCESS_KEY": "s"}, ("b", "eu-central-1", None, False)),
        ({"R2_ACCOUNT_ID": "acct", "R2_BUCKET_NAME": "r", "R2_ACCESS_KEY_ID": "k", "R2_SECRET_ACCESS_KEY": "s"}, ("r", "us-east-1", "https://acct.r2.cloudflarestorage.com", False)),
    ],
)
def test_storage_is_chosen_as_the_website_chooses_it(env, expected):
    names = ("S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "R2_ENDPOINT", "R2_ACCOUNT_ID", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
    config = resolve_storage_config(SimpleNamespace(**{n: env.get(n) for n in names}))
    assert (config.bucket, config.region, config.endpoint, config.force_path_style) == expected


def test_scanner_replies_are_read_as_the_website_reads_them():
    assert malware_scan.parse_reply("stream: OK\0").status == "clean"
    infected = malware_scan.parse_reply(f"stream: {EICAR} FOUND\0")
    assert (infected.status, infected.signature) == ("infected", EICAR)
    assert malware_scan.parse_reply("INSTREAM size limit exceeded. ERROR").status == "unavailable"


def test_every_write_waits_for_the_switch(api, monkeypatch, world):
    monkeypatch.setattr(settings, "PIPELINE_WRITES_ENABLED", False)
    for res in (
        upload(api, world.own, world.passport),
        api.patch(f"{URL}/cx/verify", headers=world.sup, json={"verification_status": "verified"}),
        api.post(f"{URL}/readable", headers={"X-Vertex-Service": service_token()}, json={"storage_path": "x"}),
        api.post(f"{URL}/form-upload", headers={"X-Vertex-Service": service_token()}, params={"candidate_id": "c", "type": "x"}),
    ):
        assert (res.status_code, error(res)["code"]) == (503, "pipeline_not_enabled")
    assert len(module.router.routes) == 4


# --- uploading ---------------------------------------------------------------


def test_a_candidate_uploads_their_last_document(api, db, world, clamd):
    for key in required_universal_types(db):
        if key != world.passport:
            db.add(Document(candidate_id=world.mine.id, type=key, storage_path=f"x/{key}"))
    db.flush()
    scans = clamd.scanned
    res = upload(api, world.own, world.passport)
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["candidate_id"], data["type"], data["scan_status"], data["scanned_at"] is not None, data["verification_status"]) == (
        world.mine.id, world.passport, "clean", True, "pending"
    )
    assert re.fullmatch(rf"{world.passport}/[0-9a-f-]{{36}}\.pdf", data["storage_path"])
    assert data["storage_path"] in stored() and clamd.scanned == scans + 1
    db.refresh(world.mine)
    assert world.mine.lifecycle_status is CandidateLifecycleStatus.submitted
    assert db.scalars(select(AuditLog.action).where(AuditLog.entity_id == data["id"])).all() == ["create"]


def test_a_reupload_replaces_the_file_but_other_documents_add_up(api, db, world):
    first = upload(api, world.own, world.passport).json()["data"]
    second = upload(api, world.own, world.passport, data=PNG, mime="image/png").json()["data"]
    assert first["storage_path"] not in stored() and second["storage_path"] in stored()
    assert db.get(Document, first["id"]) is None
    one = upload(api, world.own, "other", label="  Bank letter ").json()["data"]
    two = upload(api, world.own, "other", label="Reference").json()["data"]
    assert (one["label"], two["label"]) == ("Bank letter", "Reference")
    assert {one["storage_path"], two["storage_path"]} <= stored()


def test_staff_upload_for_candidates_they_reach(api, db, world):
    assert upload(api, world.rec, world.passport, candidate_id=world.mine.id).status_code == 200
    out = upload(api, world.rec, world.passport, candidate_id=world.elsewhere.id)
    assert (out.status_code, error(out)["message"]) == (403, "Forbidden.")
    _, other_candidate = person(db, Role.candidate)
    res = upload(api, other_candidate, world.passport, candidate_id=world.mine.id)
    assert (res.status_code, error(res)["message"]) == (403, "Only staff can upload on behalf of a candidate.")
    assert upload(api, world.rec, world.passport, candidate_id="cnosuch").status_code == 404
    no_profile = upload(api, world.hr, world.passport)
    assert (no_profile.status_code, error(no_profile)["message"]) == (404, "Candidate profile not found.")


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"mime": "text/plain"}, "Invalid file type. Only PDF, JPEG, and PNG are allowed."),
        ({"data": PNG}, "File content does not match an allowed type (PDF, JPEG, PNG)."),
        ({"data": b"MZ" + b"\0" * 50}, "File content does not match an allowed type (PDF, JPEG, PNG)."),
        ({"data": PDF + b"x" * (1024 * 1024)}, "File too large. Maximum size is 1MB."),
    ],
)
def test_a_bad_file_is_refused_and_not_stored(api, world, kwargs, message):
    res = upload(api, world.own, world.passport, **kwargs)
    assert (res.status_code, error(res)) == (400, {"code": "upload_rejected", "message": message})
    assert stored() == set()


def test_a_request_must_name_a_type_and_carry_a_file(api, world):
    res = upload(api, world.own, "no_such_type")
    assert (res.status_code, error(res)["message"]) == (400, "Query param 'type' must be a known document requirement type.")
    res = api.post(URL, headers=world.own, params={"type": world.passport}, data={"label": "x"})
    assert res.status_code == 400 and error(res)["code"] in ("no_file", "invalid_form")


def test_malware_is_refused_and_recorded(api, db, world, clamd):
    clamd.reply = f"stream: {EICAR} FOUND"
    res = upload(api, world.own, world.passport)
    assert (res.status_code, error(res)) == (422, {"code": "malware_detected", "message": "This file was rejected by the malware scanner.", "details": {"signature": EICAR}})
    assert stored() == set()
    event = db.scalars(select(AuditLog).where(AuditLog.entity_id == world.mine.id, AuditLog.action == "malware_rejected")).one()
    assert (event.actor_id, event.after["signature"]) == (world.owner.id, EICAR)


def test_with_the_scanner_down_the_upload_is_kept_unscanned(api, world, monkeypatch):
    monkeypatch.setattr(settings, "CLAMD_PORT", 1)  # nothing listens there
    monkeypatch.setattr(settings, "CLAMD_TIMEOUT_MS", 2000)
    data = upload(api, world.own, world.passport).json()["data"]
    assert (data["scan_status"], data["scanned_at"]) == ("unscanned", None)


def test_without_storage_uploads_are_unavailable(api, world, monkeypatch):
    monkeypatch.setattr(settings, "S3_BUCKET", None)
    res = upload(api, world.own, world.passport)
    assert (res.status_code, error(res)["code"]) == (503, "storage_unavailable")


# --- partner drafts ----------------------------------------------------------


@pytest.fixture
def draft(db):
    partner_user, as_partner = person(db, Role.partner)
    partner = Partner(name="P", partner_type=PartnerType.other, country_of_operation="Kenya", contact_name="Pat", contact_email=f"p-{secrets.token_hex(3)}@test.invalid", contact_phone="1", user_id=partner_user.id)
    db.add(partner)
    db.flush()
    row = PartnerCandidate(partner_id=partner.id, full_name="Draft person", status=PartnerCandidateStatus.draft)
    db.add(row)
    db.flush()
    return SimpleNamespace(row=row, as_partner=as_partner)


def test_a_partner_attaches_files_to_its_draft(api, db, world, draft):
    res = upload(api, draft.as_partner, world.passport, partner_candidate_id=draft.row.id)
    assert res.status_code == 200
    assert (res.json()["data"]["partner_candidate_id"], res.json()["data"]["candidate_id"]) == (draft.row.id, None)
    assert upload(api, world.hr, world.passport, partner_candidate_id=draft.row.id).status_code == 200  # on its behalf
    _, someone_else = person(db, Role.partner)
    assert error(upload(api, someone_else, world.passport, partner_candidate_id=draft.row.id))["message"] == "Draft not found."
    refused = upload(api, world.rec, world.passport, partner_candidate_id=draft.row.id)
    assert (refused.status_code, error(refused)["message"]) == (403, "Only the owning partner or HR/Operations can upload to a draft.")
    draft.row.status = PartnerCandidateStatus.submitted
    db.flush()
    late = upload(api, draft.as_partner, world.passport, partner_candidate_id=draft.row.id)
    assert (late.status_code, error(late)["code"]) == (409, "not_a_draft")


# --- the form's upload token -------------------------------------------------


def form_token(candidate_id: str, *, lifetime: int = 600) -> str:
    claims = {"candidateId": candidate_id, "type": "cif_upload", "exp": int(time.time()) + lifetime, "iss": "vertex-web", "aud": "vertex:cif_upload"}
    return jwt.encode(claims, key_for("cif_upload", SECRET), algorithm="HS256")


def form_upload(api, candidate_id, token, document_type, *, service=True):
    headers = {"X-Upload-Token": token} | ({"X-Vertex-Service": service_token()} if service else {})
    return api.post(f"{URL}/form-upload", headers=headers, params={"candidate_id": candidate_id, "type": document_type}, files={"file": ("a.pdf", PDF, "application/pdf")})


def test_the_form_attaches_documents_before_any_account(api, db, world):
    res = form_upload(api, world.elsewhere.id, form_token(world.elsewhere.id), world.passport)
    assert (res.status_code, res.json()["data"]["candidate_id"]) == (200, world.elsewhere.id)
    actors = db.scalars(select(AuditLog.actor_id).where(AuditLog.entity_id == res.json()["data"]["id"])).all()
    assert actors == [None]


def test_the_form_upload_checks_its_token(api, world):
    other = form_upload(api, world.elsewhere.id, form_token(world.mine.id), world.passport)
    assert other.status_code == 403
    expired = form_upload(api, world.elsewhere.id, form_token(world.elsewhere.id, lifetime=-5), world.passport)
    assert (expired.status_code, error(expired)["message"]) == (401, "This upload link has expired. Please refresh and resubmit the form.")
    assert form_upload(api, world.elsewhere.id, form_token(world.elsewhere.id), world.passport, service=False).status_code == 401
    assert stored() == set()


# --- verification ------------------------------------------------------------


def test_a_supervisor_verifies_a_document(api, db, world):
    doc = upload(api, world.own, world.passport).json()["data"]
    assert api.patch(f"{URL}/{doc['id']}/verify", headers=world.rec, json={"verification_status": "verified"}).status_code == 403
    res = api.patch(f"{URL}/{doc['id']}/verify", headers=world.sup, json={"verification_status": "rejected"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["verification_status"], data["verified_by"] is not None, data["verified_at"] is not None) == ("rejected", True, True)
    assert api.patch(f"{URL}/{doc['id']}/verify", headers=world.sup, json={"verification_status": "pending"}).status_code == 422
    assert api.patch(f"{URL}/cnosuch/verify", headers=world.sup, json={"verification_status": "verified"}).status_code == 404


def test_verification_stays_in_scope(api, db, world):
    doc = Document(candidate_id=world.elsewhere.id, type=world.passport, storage_path="x/elsewhere.pdf")
    db.add(doc)
    db.flush()
    assert api.patch(f"{URL}/{doc.id}/verify", headers=world.sup, json={"verification_status": "verified"}).status_code == 403
    assert api.patch(f"{URL}/{doc.id}/verify", headers=world.hr, json={"verification_status": "verified"}).json()["data"]["verification_status"] == "verified"
    assert db.get(Document, doc.id).verification_status is VerificationStatus.verified


# --- opening a document ------------------------------------------------------


def readable(api, path, headers=None):
    return api.post(f"{URL}/readable", headers={"X-Vertex-Service": service_token()} | (headers or {}), json={"storage_path": path})


@pytest.fixture
def unscanned(db, world):
    path = f"{world.passport}/held.pdf"
    boto3.client("s3", region_name="eu-central-1").put_object(Bucket=BUCKET, Key=path, Body=PDF)
    doc = Document(candidate_id=world.mine.id, type=world.passport, storage_path=path, scan_status="unscanned")
    db.add(doc)
    db.flush()
    return doc


def test_an_unscanned_document_is_scanned_when_opened(api, db, world, unscanned):
    res = readable(api, unscanned.storage_path, world.own)
    assert res.json() == {"data": {"scan_status": "clean"}}
    db.refresh(unscanned)
    assert (unscanned.scan_status, unscanned.scanned_at is not None) == ("clean", True)
    actor = db.scalars(select(AuditLog.actor_id).where(AuditLog.entity_id == unscanned.id, AuditLog.action == "update")).one()
    assert actor == world.owner.id


def test_an_infected_document_is_blocked(api, db, world, unscanned, clamd):
    clamd.reply = f"stream: {EICAR} FOUND"
    res = readable(api, unscanned.storage_path)
    assert (res.status_code, error(res)["code"]) == (403, "document_blocked")
    db.refresh(unscanned)
    assert unscanned.scan_status == "infected"
    assert db.scalars(select(AuditLog).where(AuditLog.entity_id == unscanned.id, AuditLog.action == "malware_blocked_download")).one().actor_id is None
    assert error(res)["details"] == {"document_id": unscanned.id, "newly_found": True, "signature": EICAR}
    clamd.reply = "stream: OK"
    again = readable(api, unscanned.storage_path)
    assert (again.status_code, error(again)["details"]["newly_found"]) == (403, False)  # stays blocked, no new alert


def test_with_the_scanner_down_a_document_is_served_unscanned(api, db, unscanned, monkeypatch):
    monkeypatch.setattr(settings, "CLAMD_PORT", 1)
    monkeypatch.setattr(settings, "CLAMD_TIMEOUT_MS", 2000)
    assert readable(api, unscanned.storage_path).json() == {"data": {"scan_status": "unscanned"}}


def test_a_file_that_is_not_a_candidate_document_is_not_tracked(api):
    assert readable(api, "invoices/2026/abc.pdf").json() == {"data": {"scan_status": None}}
    assert api.post(f"{URL}/readable", json={"storage_path": "x"}).status_code == 401  # Next.js only


# --- as the API's database role ---------------------------------------------


def test_the_api_database_role_can_write_them(api, db, world):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        up = upload(api, world.own, world.passport)
        verified = api.patch(f"{URL}/{up.json()['data']['id']}/verify", headers=world.sup, json={"verification_status": "verified"})
    finally:
        db.execute(text("RESET ROLE"))
    assert (up.status_code, verified.status_code) == (200, 200)


def test_storage_refuses_without_configuration(monkeypatch):
    monkeypatch.setattr(settings, "S3_BUCKET", None)
    with pytest.raises(StorageNotConfigured):
        resolve_storage_config()
