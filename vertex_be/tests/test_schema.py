import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import select, text
from sqlalchemy.exc import InternalError

from app.db.base import Base, new_id
from app.db.session import engine
from app.models import AuditLog, Candidate, Country, Region, User
from app.models.enums import CandidateLifecycleStatus, Role


def test_models_match_migrated_schema():
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        diff = compare_metadata(ctx, Base.metadata)
    assert diff == [], f"models and migrations disagree: {diff}"


def test_new_id_is_cuid_shaped_and_unique():
    ids = {new_id() for _ in range(1000)}
    assert len(ids) == 1000
    assert all(i.startswith("c") and len(i) >= 24 for i in ids)


def test_round_trip_with_defaults_and_relationships(db):
    region = Region(name="Test Region")
    country = Country(name="Testland", region=region)
    recruiter = User(full_name="R", email="r@test.local", role=Role.regional_recruiter,
                     assigned_country=country)
    candidate = Candidate(full_name="C", recruiter=recruiter, country=country)
    db.add(candidate)
    db.flush()

    db.expire_all()
    loaded = db.scalar(select(Candidate).where(Candidate.id == candidate.id))
    assert loaded.lifecycle_status is CandidateLifecycleStatus.identified
    assert loaded.consent_given is False
    assert loaded.created_at is not None
    assert loaded.recruiter.assigned_country.region.name == "Test Region"


def test_audit_log_is_immutable(db):
    entry = AuditLog(entity_type="Candidate", entity_id="x", action="create")
    db.add(entry)
    db.flush()
    with pytest.raises(InternalError, match="immutable"):
        db.execute(text('UPDATE "AuditLog" SET action = \'tampered\''))


def test_password_or_role_change_bumps_token_version(db):
    # G19: whatever code path changes a credential or a role, every session
    # issued before the change stops working.
    user = User(full_name="V", email="v@test.local", password_hash="a")
    db.add(user)
    db.flush()

    def version() -> int:
        return db.scalar(text('SELECT token_version FROM "User" WHERE id = :id'), {"id": user.id})

    assert version() == 0
    db.execute(text("""UPDATE "User" SET full_name = 'W' WHERE id = :id"""), {"id": user.id})
    assert version() == 0
    db.execute(text("""UPDATE "User" SET password_hash = 'b' WHERE id = :id"""), {"id": user.id})
    assert version() == 1
    db.execute(text("""UPDATE "User" SET role = 'admin' WHERE id = :id"""), {"id": user.id})
    assert version() == 2
