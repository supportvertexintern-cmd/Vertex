"""The audit trail (app/core/audit.py): every write to an audited model is
recorded in the same transaction, with a declared actor, and nothing gets
around it through the ORM. The audited models match vertex/src/lib/audit.ts."""

import logging
import re
import secrets

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.core import audit
from app.core.auth import AuthUser
from app.core.config import BASE_DIR
from app.core.logging import REDACTED, request_id_var
from app.core.rbac import require_role
from app.db.base import Base
from app.db.session import engine, get_db
from app.main import create_app
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.identity import User
from app.models.payments import ConsultationBooking
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

AUDIT_TS = BASE_DIR.parent / "vertex" / "src" / "lib" / "audit.ts"


def trail(db, entity_id: str) -> list[AuditLog]:
    return list(db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.created_at, AuditLog.id)))


def new_user(db, **fields) -> User:
    u = User(full_name="Audit Test", email=f"audit-{secrets.token_hex(4)}@test.invalid", password_hash="hash-value", **fields)
    db.add(u)
    db.flush()
    return u


def test_the_audited_models_match_audit_ts():
    body = re.search(r"const AUDITED_MODELS = new Set\(\[(.*?)\]\)", AUDIT_TS.read_text(encoding="utf-8"), re.S)
    assert set(re.findall(r'"(\w+)"', body.group(1))) == set(audit.AUDITED_MODELS)


def test_every_audited_model_is_a_table():
    assert audit.AUDITED_MODELS <= set(Base.metadata.tables)


def test_create_update_and_delete_are_recorded_with_actor_and_request(db):
    audit.set_audit_actor(db, "actor-1")
    token = request_id_var.set("req-audit-1")
    try:
        u = new_user(db, role=Role.candidate)
        u.full_name = "Renamed"
        db.flush()
        db.delete(u)
        db.flush()
    finally:
        request_id_var.reset(token)

    created, updated, deleted = trail(db, u.id)
    assert [r.action for r in (created, updated, deleted)] == ["create", "update", "delete"]
    assert {r.actor_id for r in (created, updated, deleted)} == {"actor-1"}
    assert {r.request_id for r in (created, updated, deleted)} == {"req-audit-1"}
    assert created.before is None and created.after["full_name"] == "Audit Test"
    assert updated.before["full_name"] == "Audit Test" and updated.after["full_name"] == "Renamed"
    assert deleted.before["full_name"] == "Renamed" and deleted.after is None


def test_snapshots_never_hold_the_password_hash(db):
    u = new_user(db)
    u.password_hash = "another-hash"
    db.flush()
    for row in trail(db, u.id):
        for snap in (row.before, row.after):
            if snap is not None:
                assert snap["password_hash"] == REDACTED


def test_snapshots_are_shaped_like_prisma_json(db):
    u = new_user(db, role=Role.finance)
    [row] = trail(db, u.id)
    assert row.after["role"] == "finance"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", row.after["created_at"])


def test_an_unchanged_object_is_not_recorded(db):
    u = new_user(db)
    u.full_name = u.full_name
    db.flush()
    assert len(trail(db, u.id)) == 1


def test_unaudited_models_need_no_actor_and_leave_no_record(db):
    db.info.pop("audit_actor")
    b = ConsultationBooking(email="audit@test.invalid", amount=50, stripe_checkout_session_id=f"cs_{secrets.token_hex(6)}")
    db.add(b)
    db.flush()
    assert trail(db, b.id) == []


def test_an_audited_write_without_an_actor_is_refused(db):
    with Session(bind=db.connection(), join_transaction_mode="create_savepoint") as bare:
        bare.add(User(full_name="No actor", email=f"audit-{secrets.token_hex(4)}@test.invalid"))
        with pytest.raises(audit.AuditActorMissing):
            bare.flush()


@pytest.mark.parametrize("kind", ["update", "delete"])
def test_bulk_statements_on_audited_tables_are_refused(db, kind):
    from sqlalchemy import delete

    stmt = update(User).values(full_name="x") if kind == "update" else delete(User)
    with pytest.raises(audit.AuditBypassRefused):
        db.execute(stmt.where(User.id == "nobody"))


def test_vertex_api_can_write_audited_rows_without_reading_the_trail(db):
    # The trail row goes in without RETURNING: vertex_api may append, not read.
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        u = new_user(db)
    finally:
        db.execute(text("RESET ROLE"))
    assert [r.action for r in trail(db, u.id)] == ["create"]


def test_granting_admin_is_logged(db, caplog):
    u = new_user(db, role=Role.director)
    with caplog.at_level(logging.WARNING, logger="vertex"):
        u.role = Role.admin
        db.flush()
    [record] = [r for r in caplog.records if getattr(r, "event", None) == "security.privilege_granted"]
    assert (record.fields["was"], record.fields["now"], record.fields["user_id"]) == ("director", "admin", u.id)


def test_a_security_event_is_committed_on_its_own(db):
    entity = f"/api/v1/probe/{secrets.token_hex(4)}"
    audit.record_security_event("access_denied", actor_id="actor-2", entity_type="Route", entity_id=entity, detail={"reason": "role", "password": "x"})
    # Committed outside the test's transaction, so another connection sees it.
    with engine.connect() as other:
        row = other.execute(select(AuditLog.action, AuditLog.actor_id, AuditLog.after).where(AuditLog.entity_id == entity)).one()
    assert row.action == "access_denied" and row.actor_id == "actor-2"
    assert row.after == {"reason": "role", "password": REDACTED}


def test_a_failed_security_event_write_never_raises(monkeypatch, caplog):
    class Broken:
        def begin(self):
            raise ConnectionError("database down")

    monkeypatch.setattr(audit, "engine", Broken())
    with caplog.at_level(logging.ERROR, logger="vertex"):
        audit.record_security_event("access_denied", actor_id=None, entity_type="Route", entity_id="/x")
    assert any(getattr(r, "event", None) == "audit.write_failed" for r in caplog.records)


# A probe app: a route that writes through AuditedDb, and one that refuses.
probe = create_app()


@probe.post("/api/v1/probe/rename")
def rename(db: audit.AuditedDb, user: AuthUser = Depends(require_role(Role.admin))):
    target = db.get(User, user.user_id)
    target.full_name = "Renamed by request"
    db.flush()
    return {"ok": True}


@pytest.fixture
def api(db):
    probe.dependency_overrides[get_db] = lambda: db
    yield TestClient(probe)
    probe.dependency_overrides.pop(get_db, None)


def signed_in(db, role: Role) -> tuple[User, dict[str, str]]:
    u = new_user(db, role=role)
    db.refresh(u)
    s = add_session(db, u.id)
    return u, bearer(session_token(u.id, s.family_id, u.token_version))


def test_a_route_writes_as_the_signed_in_caller(api, db):
    u, headers = signed_in(db, Role.admin)
    db.info.pop("audit_actor")  # the route, not the fixture, must set it
    assert api.post("/api/v1/probe/rename", headers=headers).status_code == 200
    update_row = trail(db, u.id)[-1]
    assert (update_row.action, update_row.actor_id, update_row.after["full_name"]) == ("update", u.id, "Renamed by request")


def test_a_role_refusal_is_in_the_trail(api, db):
    u, headers = signed_in(db, Role.marketing)
    assert api.post("/api/v1/probe/rename", headers=headers).status_code == 403
    with engine.connect() as other:
        row = other.execute(
            select(AuditLog.entity_type, AuditLog.after).where(AuditLog.actor_id == u.id, AuditLog.action == "access_denied")
        ).one()
    assert row.entity_type == "Route"
    assert row.after["role"] == "marketing" and row.after["allowed"] == ["admin"]
    assert row.after["path"] == "/api/v1/probe/rename"
