"""Nothing a user deletes leaves the database (app/db/soft_delete.py): it can't
be seen again by any query, what the foreign keys did still happens, the trail
says "delete", and a real DELETE can't get through."""

import secrets

import pytest
from sqlalchemy import exists, func, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

from app.core.audit import set_audit_actor
from app.core.clock import utc_now_ms
from app.db.base import SOFT_DELETE_COLUMNS, Base, SoftDeletable
from app.db.session import get_db
from app.db.soft_delete import HardDeleteRefused
from app.main import app
from app.models.audit import AuditLog
from app.models.candidate import Candidate
from app.models.enums import CandidateSource, CaseStage, Role
from app.models.identity import Country, RefreshToken, Region, User
from app.models.jobs import Job, JobPaymentStage
from app.services import backup
from tests.test_auth import add_session, bearer, session_token


def unique(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(4)}"


@pytest.fixture
def world(db):
    set_audit_actor(db, None)
    region = Region(name=unique("Region"))
    db.add(region)
    db.flush()
    country = Country(name=unique("Country"), region_id=region.id)
    db.add(country)
    db.flush()
    recruiter = User(full_name="Recruiter", email=f"{unique('r')}@test.invalid", role=Role.regional_recruiter)
    db.add(recruiter)
    db.flush()
    candidate = Candidate(full_name="Someone", source=CandidateSource.recruiter_sourced, recruiter_id=recruiter.id, country_id=country.id)
    db.add(candidate)
    db.flush()
    return region, country, recruiter, candidate


def raw(db, table: str, row_id: str):
    """The row as it really is, past the ORM's filter."""
    return db.execute(text(f'SELECT * FROM "{table}" WHERE id = :i'), {"i": row_id}).mappings().first()


def test_every_table_but_the_exempt_three_is_soft_deleted():
    # SecurityAlert (admin monitoring, phase 2) is a security record like the
    # trail: never deleted, it has no delete route; its review is audited.
    plain = {m.local_table.name for m in Base.registry.mappers if not issubclass(m.class_, SoftDeletable)}
    assert plain == {"AuditLog", "RefreshToken", "SecurityAlert"}


def test_a_deleted_row_stays_and_no_query_finds_it(db, world):
    *_, candidate = world
    db.delete(candidate)
    db.commit()
    row = raw(db, "Candidate", candidate.id)
    assert row is not None and row["deleted_at"] is not None
    live = Candidate.id == candidate.id
    other = aliased(Candidate)
    assert db.get(Candidate, candidate.id) is None
    assert db.scalar(select(Candidate).where(live)) is None
    assert db.scalar(select(Candidate.full_name).where(live)) is None
    assert db.scalar(select(func.count()).select_from(Candidate).where(live)) == 0
    assert db.scalar(select(func.count(Candidate.id)).where(live)) == 0
    assert db.scalar(select(other).where(other.id == candidate.id)) is None
    assert db.scalar(select(Country).join(Candidate, Candidate.country_id == Country.id).where(live)) is None
    assert db.scalar(select(exists().where(live))) is False
    subquery = select(Candidate.id).where(live).scalar_subquery()
    assert db.scalar(select(subquery)) is None
    counted = select(Candidate.country_id, func.count().label("n")).where(live).group_by(Candidate.country_id).subquery()
    assert db.execute(select(Country.id, counted.c.n).join(counted, counted.c.country_id == Country.id)).first() is None


def test_only_include_deleted_shows_it(db, world):
    *_, candidate = world
    db.delete(candidate)
    db.commit()
    found = db.scalar(select(Candidate).where(Candidate.id == candidate.id).execution_options(include_deleted=True))
    assert found is not None and found.deleted_at is not None


def test_the_trail_says_delete_with_the_row_before_it(db, world):
    *_, candidate = world
    db.delete(candidate)
    db.commit()
    entries = list(db.scalars(select(AuditLog).where(AuditLog.entity_type == "Candidate", AuditLog.entity_id == candidate.id)))
    deleted = [e for e in entries if e.action == "delete"]
    assert len(deleted) == 1
    assert deleted[0].before["full_name"] == "Someone" and deleted[0].after is None


def test_cascade_goes_too_at_the_same_time(db, world):
    _region, _country, recruiter, _candidate = world
    owned = Candidate(full_name="Their own record", source=CandidateSource.self_registered, user_id=recruiter.id)
    db.add(owned)
    db.flush()
    db.delete(recruiter)
    db.commit()
    assert db.get(Candidate, owned.id) is None
    assert raw(db, "Candidate", owned.id)["deleted_at"] == raw(db, "User", recruiter.id)["deleted_at"]


def test_a_deleted_users_sessions_really_end(db, world):
    _region, _country, recruiter, _candidate = world
    token = RefreshToken(user_id=recruiter.id, family_id=unique("f"), token_hash=unique("h"), token_version=0, expires_at=utc_now_ms())
    db.add(token)
    db.flush()
    db.delete(recruiter)
    db.commit()
    assert raw(db, "RefreshToken", token.id) is None


def test_set_null_is_cleared_and_saved_for_a_restore(db, world):
    _region, _country, recruiter, candidate = world
    candidate_id, recruiter_id = candidate.id, recruiter.id
    db.delete(recruiter)
    db.commit()
    # As before: the candidate is unassigned, so it can be picked up again.
    assert db.get(Candidate, candidate_id).recruiter_id is None
    assert raw(db, "User", recruiter_id)["deleted_links"] == {"Candidate.recruiter_id": [candidate_id]}


def test_restrict_still_refuses_with_the_same_error(db, world):
    region, country, *_ = world
    db.delete(region)  # Country.region_id is RESTRICT, and the country is live
    with pytest.raises(IntegrityError) as err:
        db.flush()
    assert err.value.orig.pgcode == "23503"
    db.rollback()
    assert country.id


def test_a_soft_deleted_child_no_longer_restricts(db, world):
    region, country, *_ = world
    db.delete(country)
    db.flush()
    db.delete(region)
    db.commit()
    assert db.get(Region, region.id) is None


def test_a_real_delete_is_refused(db):
    set_audit_actor(db, None)
    job = Job(title=unique("Job"), country="Germany", city="Berlin", job_description="d", requirements="r", application_fee=1)
    db.add(job)
    db.flush()
    stage = JobPaymentStage(job_id=job.id, order=1, label="All", percent=100, trigger_stage=CaseStage.permit_authorization_approved)
    db.add(stage)
    db.flush()
    db.refresh(job)
    job.payment_stages.remove(stage)  # delete-orphan: never reaches db.delete()
    with pytest.raises(HardDeleteRefused):
        db.flush()
    db.rollback()


def test_unique_values_are_free_again(db, world):
    _region, _country, recruiter, _candidate = world
    email = recruiter.email
    db.delete(recruiter)
    db.flush()
    again = User(full_name="New owner", email=email, role=Role.regional_recruiter)
    db.add(again)
    db.flush()
    assert db.scalar(select(User).where(User.email == email)).id == again.id
    twice = User(full_name="Clash", email=email, role=Role.regional_recruiter)
    db.add(twice)
    with pytest.raises(IntegrityError):
        db.flush()  # among live rows it still holds
    db.rollback()


def test_a_relationship_doesnt_load_a_deleted_row(db, world):
    _region, _country, recruiter, _candidate = world
    report = User(full_name="Report", email=f"{unique('u')}@test.invalid", role=Role.regional_recruiter, supervisor_id=recruiter.id)
    keep = User(full_name="Stays", email=f"{unique('u')}@test.invalid", role=Role.regional_recruiter, supervisor_id=recruiter.id)
    db.add_all([report, keep])
    db.flush()
    db.delete(report)
    db.commit()
    db.expire_all()
    assert [u.id for u in db.get(User, recruiter.id).direct_reports] == [keep.id]


def test_a_deleted_user_loses_access_at_once(db, client, world):
    _region, _country, recruiter, _candidate = world
    session = add_session(db, recruiter.id)
    headers = bearer(session_token(recruiter.id, session.family_id, recruiter.token_version, role=recruiter.role.value))
    app.dependency_overrides[get_db] = lambda: db
    try:
        assert client.get("/api/v1/me", headers=headers).status_code == 200
        db.delete(recruiter)
        db.commit()
        assert client.get("/api/v1/me", headers=headers).status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_a_backup_export_leaves_deleted_rows_out(db, world):
    *_, candidate = world
    mapper = inspect(Candidate)
    assert candidate.id in {r["id"] for r in backup._fetch(db, Role.admin, mapper, [])}
    db.delete(candidate)
    db.commit()
    rows = backup._fetch(db, Role.admin, mapper, [])
    assert candidate.id not in {r["id"] for r in rows}
    assert all(not SOFT_DELETE_COLUMNS & set(r) for r in rows)


def test_the_columns_stay_out_of_every_answer():
    schemas = app.openapi()["components"]["schemas"]
    leaked = [name for name, s in schemas.items() if SOFT_DELETE_COLUMNS & set(s.get("properties", {}))]
    assert leaked == ["DeletedRow"]  # the admin's list of deleted records, its purpose
