"""Bringing a soft deleted record back (app/api/v1/deleted.py): only admins, with
what was deleted with it, its links, and a clear refusal when it can't."""

import secrets

import pytest
from sqlalchemy import select, text

from app.core.audit import set_audit_actor
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Candidate, Document
from app.models.enums import CandidateSource, Role
from app.models.identity import Country, Region, User
from app.models.reference import DocumentRequirementType
from tests.test_auth import add_session, bearer, session_token

URL = "/api/v1/deleted"


def unique(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4)}"


@pytest.fixture
def api(db, client):
    app.dependency_overrides[get_db] = lambda: db
    yield client
    app.dependency_overrides.pop(get_db, None)


def signed_in(db, role: Role) -> tuple[User, dict[str, str]]:
    u = User(full_name="Signed in", email=f"{unique('s')}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version, role=role.value))


@pytest.fixture
def admin(db) -> dict[str, str]:
    set_audit_actor(db, None)
    return signed_in(db, Role.admin)[1]


@pytest.fixture
def recruiter(db) -> User:
    set_audit_actor(db, None)
    u = User(full_name="Recruiter", email=f"{unique('r')}@test.invalid", role=Role.regional_recruiter)
    db.add(u)
    db.flush()
    return u


def candidate_of(db, **fields) -> Candidate:
    c = Candidate(full_name=fields.pop("full_name", "Someone"), source=CandidateSource.recruiter_sourced, **fields)
    db.add(c)
    db.flush()
    return c


def gone(db, row) -> None:
    db.delete(row)
    db.commit()


def test_only_admins(api, db, admin, recruiter):
    _user, staff = signed_in(db, Role.regional_recruiter)
    assert api.get(URL).status_code == 401
    assert api.get(URL, headers=staff).status_code == 403
    assert api.post(f"{URL}/User/{recruiter.id}/restore", headers=staff).status_code == 403


def test_the_list_shows_deleted_records_newest_first(api, db, admin):
    first, second = candidate_of(db, full_name="First"), candidate_of(db, full_name="Second")
    live = candidate_of(db, full_name="Live")
    gone(db, first)
    gone(db, second)
    rows = api.get(URL, headers=admin, params={"table": "Candidate"}).json()["data"]
    ids = [r["id"] for r in rows]
    assert first.id in ids and second.id in ids and live.id not in ids
    assert ids.index(second.id) < ids.index(first.id)
    assert next(r for r in rows if r["id"] == first.id)["label"] == "First"
    everything = api.get(URL, headers=admin).json()["data"]
    assert {"table": "Candidate", "id": second.id} .items() <= next(r for r in everything if r["id"] == second.id).items()


def test_an_unknown_table_or_a_live_row_is_a_404(api, db, admin, recruiter):
    assert api.get(URL, headers=admin, params={"table": "AuditLog"}).status_code == 404
    assert api.post(f"{URL}/AuditLog/x/restore", headers=admin).status_code == 404
    assert api.post(f"{URL}/User/{recruiter.id}/restore", headers=admin).status_code == 404
    assert api.post(f"{URL}/User/cnosuch/restore", headers=admin).status_code == 404


def test_restoring_brings_it_back_and_the_trail_says_so(api, db, admin):
    c = candidate_of(db)
    candidate_id = c.id
    gone(db, c)
    assert db.get(Candidate, candidate_id) is None
    res = api.post(f"{URL}/Candidate/{candidate_id}/restore", headers=admin)
    assert res.status_code == 200
    assert res.json()["data"] == {"table": "Candidate", "id": candidate_id, "restored": 1}
    back = db.get(Candidate, candidate_id)
    assert back is not None and back.deleted_at is None and back.deleted_links is None
    actions = db.scalars(select(AuditLog.action).where(AuditLog.entity_type == "Candidate", AuditLog.entity_id == candidate_id).order_by(AuditLog.created_at, AuditLog.id)).all()
    assert actions[-2:] == ["delete", "restore"]


def test_what_was_deleted_with_it_comes_back_and_nothing_else(api, db, admin, recruiter):
    recruiter_id = recruiter.id
    own = candidate_of(db, full_name="Their own", user_id=recruiter_id)
    earlier = candidate_of(db, full_name="Deleted earlier", user_id=None)
    db.execute(text('UPDATE "Candidate" SET user_id = NULL WHERE id = :i'), {"i": earlier.id})
    own_id, earlier_id = own.id, earlier.id
    gone(db, earlier)
    gone(db, recruiter)
    assert db.get(Candidate, own_id) is None
    res = api.post(f"{URL}/User/{recruiter_id}/restore", headers=admin)
    assert res.json()["data"]["restored"] == 2
    assert db.get(User, recruiter_id) is not None and db.get(Candidate, own_id) is not None
    assert db.get(Candidate, earlier_id) is None


def test_the_links_its_delete_cleared_are_put_back(api, db, admin, recruiter):
    recruiter_id = recruiter.id
    kept = candidate_of(db, recruiter_id=recruiter_id)
    taken = candidate_of(db, recruiter_id=recruiter_id)
    other = candidate_of(db)
    kept_id, taken_id = kept.id, taken.id
    gone(db, recruiter)
    assert db.get(Candidate, kept_id).recruiter_id is None
    _new, _h = signed_in(db, Role.regional_recruiter)
    db.get(Candidate, taken_id).recruiter_id = _new.id
    db.commit()
    assert api.post(f"{URL}/User/{recruiter_id}/restore", headers=admin).status_code == 200
    assert db.get(Candidate, kept_id).recruiter_id == recruiter_id
    assert db.get(Candidate, taken_id).recruiter_id == _new.id  # reassigned since: left alone
    assert other.recruiter_id is None


def test_refused_while_a_record_it_needs_is_deleted(api, db, admin):
    region = Region(name=unique("Region"))
    db.add(region)
    db.flush()
    country = Country(name=unique("Country"), region_id=region.id)
    db.add(country)
    db.flush()
    region_id, country_id = region.id, country.id
    gone(db, country)
    gone(db, region)
    res = api.post(f"{URL}/Country/{country_id}/restore", headers=admin)
    assert res.status_code == 409 and res.json()["error"]["code"] == "needs_restore_first"
    assert "Region" in res.json()["error"]["message"]
    db.expunge_all()  # a request's session ends here; this test's goes on
    assert db.get(Country, country_id) is None
    assert api.post(f"{URL}/Region/{region_id}/restore", headers=admin).status_code == 200
    assert api.post(f"{URL}/Country/{country_id}/restore", headers=admin).status_code == 200


def test_refused_when_the_unique_value_has_been_taken(api, db, admin, recruiter):
    recruiter_id, email = recruiter.id, recruiter.email
    gone(db, recruiter)
    db.add(User(full_name="New owner", email=email, role=Role.regional_recruiter))
    db.commit()
    res = api.post(f"{URL}/User/{recruiter_id}/restore", headers=admin)
    assert res.status_code == 409 and res.json()["error"]["code"] == "unique_taken"


def test_a_replaced_document_stays_replaced(api, db, admin):
    c = candidate_of(db)
    kind = unique("kind")
    db.add(DocumentRequirementType(key=kind, label="A kind"))
    db.flush()
    old = Document(candidate_id=c.id, type=kind, storage_path=unique("p"))
    db.add(old)
    db.flush()
    old_id = old.id
    gone(db, old)
    db.add(Document(candidate_id=c.id, type=kind, storage_path=unique("p")))
    db.commit()
    res = api.post(f"{URL}/Document/{old_id}/restore", headers=admin)
    assert res.status_code == 409 and res.json()["error"]["code"] == "replaced"
