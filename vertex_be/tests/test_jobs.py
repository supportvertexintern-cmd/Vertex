"""Jobs and their payment stages (step 3.2) answer as Next.js's POST
/api/jobs and PUT/DELETE /api/jobs/[id] did, and FastAPI syncs their Stripe
pricing (with a fake Stripe client here; nothing reaches Stripe)."""

import logging
import re
import secrets
from contextlib import nullcontext

import pytest
from sqlalchemy import select, text

from app.api.v1 import jobs
from app.api.v1.jobs import JOB_MANAGERS, PAYMENT_RECEIPT_TYPE_PREFIX
from app.core.config import BASE_DIR
from app.db.session import get_db
from app.main import app
from app.models.audit import AuditLog
from app.models.enums import Role
from app.models.identity import User
from app.models.jobs import Job, JobPaymentStage, JobPosition, JobSector
from app.models.reference import DocumentRequirementType
from app.services.stripe_pricing import payment_stage_amounts, product_name
from tests.test_auth import add_session, bearer, session_token
from tests.test_db_roles import roles_provisioned  # noqa: F401  (vertex_api must exist)

NEXT_JOBS = BASE_DIR.parent / "vertex" / "src" / "app" / "api" / "jobs"
ISO_Z = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z")


class FakeStripe:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple] = []
        self._n = 0

    def _next(self, prefix: str) -> str:
        if self.fail:
            raise RuntimeError("Stripe is down")
        self._n += 1
        return f"{prefix}_{self._n}"

    def create_product(self, *, name, description, idempotency_key):
        self.calls.append(("product", name, description, idempotency_key))
        return self._next("prod")

    def create_price(self, *, product, unit_amount, idempotency_key):
        self.calls.append(("price", product, unit_amount, idempotency_key))
        return self._next("price")

    def set_default_price(self, product, price):
        self.calls.append(("default", product, price))


@pytest.fixture
def stripe():
    return FakeStripe()


@pytest.fixture
def api(db, client, stripe):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[jobs.session_factory] = lambda: (lambda: nullcontext(db))
    app.dependency_overrides[jobs.stripe_client] = lambda: stripe
    yield client
    for dep in (get_db, jobs.session_factory, jobs.stripe_client):
        app.dependency_overrides.pop(dep, None)


def as_role(db, role: Role) -> tuple[str, dict[str, str]]:
    u = User(full_name="Jobs Test", email=f"jobs-{secrets.token_hex(4)}@test.invalid", role=role)
    db.add(u)
    db.flush()
    db.refresh(u)
    s = add_session(db, u.id)
    return u.id, bearer(session_token(u.id, s.family_id, u.token_version))


@pytest.fixture
def marketing(db):
    return as_role(db, Role.marketing)[1]


def new_job(**fields) -> dict:
    job = {
        "title": f"Farm work {secrets.token_hex(3)}",
        "country": "Serbia",
        "city": "Novi Sad",
        "job_description": "Seasonal farm work on a family-run orchard, with housing provided.",
        "requirements": "Two years of farm experience.",
    }
    return job | fields


STAGES = [
    {"order": 1, "label": "At application", "percent": 20, "trigger_stage": "registration_document_submission"},
    {"order": 2, "label": "Permit approved", "percent": 80, "trigger_stage": "permit_authorization_approved"},
]


def stages_of(db, job_id: str) -> list[JobPaymentStage]:
    return list(db.scalars(select(JobPaymentStage).where(JobPaymentStage.job_id == job_id).order_by(JobPaymentStage.order)))


def test_the_managers_match_next_js():
    for route in (
        "route.ts",
        "[id]/route.ts",
        "[id]/sync-stripe-pricing/route.ts",
        "[id]/sectors/route.ts",
        "[id]/sectors/[sectorId]/route.ts",
        "[id]/sectors/[sectorId]/positions/route.ts",
        "[id]/sectors/[sectorId]/positions/[positionId]/route.ts",
    ):
        src = (NEXT_JOBS / route).read_text(encoding="utf-8")
        roles = re.search(r"const JOB_MANAGER_ROLES = \[(.*?)\]", src).group(1)
        assert set(re.findall(r'"(\w+)"', roles)) == {r.value for r in JOB_MANAGERS}, route


# --- create ------------------------------------------------------------------


def test_marketing_creates_a_job_in_prismas_shape(api, db, marketing):
    res = api.post("/api/v1/jobs", headers=marketing, json=new_job())
    assert res.status_code == 201
    job = res.json()["data"]
    assert (job["status"], job["is_credit_service"], job["partner_only"], job["service_fee_gbp"]) == ("active", False, False, None)
    assert ISO_Z.fullmatch(job["created_at"]) and "payment_stages" not in job


def test_a_job_with_a_fee_gets_its_stages_and_receipt_types(api, db, marketing):
    job = api.post("/api/v1/jobs", headers=marketing, json=new_job(service_fee_gbp=1000, payment_stages=STAGES)).json()["data"]
    stages = stages_of(db, job["id"])
    assert [(s.order, s.label, s.percent) for s in stages] == [(1, "At application", 20), (2, "Permit approved", 80)]
    labels = {
        t.key: t.label
        for t in db.scalars(select(DocumentRequirementType).where(DocumentRequirementType.key.in_([f"{PAYMENT_RECEIPT_TYPE_PREFIX}{s.id}" for s in stages])))
    }
    assert sorted(labels.values()) == ["Payment Receipt — At application", "Payment Receipt — Permit approved"]


@pytest.mark.parametrize(
    ("fields", "field", "message"),
    [
        ({"job_description": "Too short."}, "job_description", "Job description must be at least 50 characters"),
        ({"requirements": "Short."}, "requirements", "Requirements must be at least 20 characters"),
        ({"service_fee_gbp": 500}, "payment_stages", "At least one payment stage is required when a service fee is set"),
        ({"service_fee_gbp": 500, "payment_stages": [STAGES[1], {**STAGES[0], "percent": 20.5}]}, "payment_stages", "Payment stage percentages must not exceed 100"),
    ],
)
def test_create_rules_and_messages(api, marketing, fields, field, message):
    res = api.post("/api/v1/jobs", headers=marketing, json=new_job(**fields))
    assert res.status_code == 422
    assert message in res.json()["error"]["details"][field]


@pytest.mark.parametrize(
    "fields",
    [{"title": "ab"}, {"status": "archived"}, {"service_fee_gbp": 0}, {"payment_stages": [{**STAGES[0], "percent": 0}]}, {"status": None}],
)
def test_create_input_rules(api, marketing, fields):
    assert api.post("/api/v1/jobs", headers=marketing, json=new_job(**fields)).status_code == 422


def test_stages_rounding_to_100_are_accepted(api, marketing):
    thirds = [{**STAGES[0], "order": i, "percent": 33.33} for i in (1, 2, 3)]  # 99.99
    assert api.post("/api/v1/jobs", headers=marketing, json=new_job(service_fee_gbp=900, payment_stages=thirds)).status_code == 201


def test_an_unknown_employer_is_a_validation_error(api, marketing):
    res = api.post("/api/v1/jobs", headers=marketing, json=new_job(employer_client_id="emp_nobody"))
    assert (res.status_code, list(res.json()["error"]["details"])) == (422, ["employer_client_id"])


@pytest.mark.parametrize("role", list(Role))
def test_only_marketing_and_admin_write_jobs(api, db, role):
    _, headers = as_role(db, role)
    expected = 201 if role in JOB_MANAGERS else 403
    assert api.post("/api/v1/jobs", headers=headers, json=new_job()).status_code == expected


# --- update ------------------------------------------------------------------


@pytest.fixture
def job(api, marketing):
    return api.post("/api/v1/jobs", headers=marketing, json=new_job(service_fee_gbp=1000, payment_stages=STAGES)).json()["data"]


def test_an_edit_changes_only_what_it_sends(api, db, marketing, job):
    res = api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"status": "closed", "salary_range": "£1,800"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert (data["status"], data["salary_range"], data["title"]) == ("closed", "£1,800", job["title"])


def test_an_unchanged_legacy_field_is_not_held_to_its_minimum(api, db, marketing, job):
    db.get(Job, job["id"]).job_description = "Short legacy text."
    db.flush()
    ok = api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"job_description": "Short legacy text.", "status": "closed"})
    assert ok.status_code == 200
    changed = api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"job_description": "Other short text."})
    assert changed.status_code == 422


@pytest.mark.parametrize("fields", [{"title": None}, {"payment_stages": []}, {"payment_stages": [{**STAGES[0], "percent": 101}]}, ["not", "an", "object"]])
def test_edit_rules(api, marketing, job, fields):
    assert api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json=fields).status_code == 422


def test_an_edit_clears_a_nullish_field_and_can_drop_the_fee(api, db, marketing, job):
    res = api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"visa_type": None, "service_fee_gbp": None, "payment_stages": []})
    assert res.status_code == 200
    assert (res.json()["data"]["service_fee_gbp"], stages_of(db, job["id"])) == (None, [])


def test_an_edit_keeps_stages_in_place(api, db, marketing, job, stripe):
    before = {s.order: s.id for s in stages_of(db, job["id"])}
    new_plan = [{**STAGES[0], "label": "Deposit", "percent": 30}, {**STAGES[1], "order": 3, "percent": 70}]
    assert api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"payment_stages": new_plan}).status_code == 200
    after = stages_of(db, job["id"])
    assert [(s.order, s.label, s.percent) for s in after] == [(1, "Deposit", 30), (3, "Permit approved", 70)]
    assert after[0].id == before[1]  # kept: same id, same Stripe product and receipt type
    assert db.get(JobPaymentStage, before[2]) is None
    assert after[0].stripe_product_id == "prod_1"


def test_a_stage_with_payments_is_not_removed(api, db, marketing, job):
    stage = stages_of(db, job["id"])[1]
    db.execute(text("SET LOCAL session_replication_role = replica"))  # a payment without building a whole case
    db.execute(
        text("""INSERT INTO "CasePayment" (id, case_id, job_payment_stage_id, amount, recorded_by)
                VALUES (:id, 'cno-case', :stage, 800, 'cno-user')"""),
        {"id": f"cpay{secrets.token_hex(6)}", "stage": stage.id},
    )
    db.execute(text("SET LOCAL session_replication_role = origin"))
    res = api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"payment_stages": [STAGES[0]]})
    assert (res.status_code, res.json()["error"]["code"]) == (409, "in_use")
    assert len(stages_of(db, job["id"])) == 2


def test_a_missing_job(api, marketing):
    for res in (
        api.put("/api/v1/jobs/cnosuchjob0000", headers=marketing, json={"status": "closed"}),
        api.delete("/api/v1/jobs/cnosuchjob0000", headers=marketing),
        api.post("/api/v1/jobs/cnosuchjob0000/stripe-pricing/sync", headers=marketing),
    ):
        assert (res.status_code, res.json()["error"]["message"]) == (404, "Job not found.")


# --- delete ------------------------------------------------------------------


def test_marketing_deletes_a_job_and_its_stages(api, db, marketing, job):
    stage_ids = [s.id for s in stages_of(db, job["id"])]
    res = api.delete(f"/api/v1/jobs/{job['id']}", headers=marketing)
    assert (res.status_code, res.json()) == (200, {"data": {"id": job["id"]}})
    assert db.get(Job, job["id"]) is None and all(db.get(JobPaymentStage, i) is None for i in stage_ids)


def test_only_job_managers_delete(api, db, job):
    _, director = as_role(db, Role.director)
    assert api.delete(f"/api/v1/jobs/{job['id']}", headers=director).status_code == 403


# --- Stripe ------------------------------------------------------------------


def test_payment_stage_amounts_match_the_website():
    assert payment_stage_amounts(1000, [33.33, 33.33, 33.34]) == [333.3, 333.3, 333.4]
    assert payment_stage_amounts(0.5, [1, 1]) == [0.01, 0.0]  # half up, as Math.round
    assert payment_stage_amounts(1000, [20, 40]) == [200, 400]


def test_product_name():
    job = Job(country="Serbia", visa_type="Visa D", duration_permit="6 months · TRC possible")
    assert product_name(job) == "Serbia, Visa D, 6 months"


def test_a_saved_job_gets_its_stripe_prices(api, db, job, stripe):
    stages = stages_of(db, job["id"])
    assert [(s.stripe_product_id, s.stripe_price_id, s.synced_amount_gbp) for s in stages] == [("prod_1", "price_2", 200), ("prod_3", "price_4", 800)]
    assert stripe.calls[0] == ("product", "Serbia", "At application", f"vertex-stage-{stages[0].id}-product")
    assert stripe.calls[1][2] == 20000  # pence


def test_a_fee_change_makes_a_new_price_on_the_same_product(api, db, marketing, job, stripe):
    stripe.calls.clear()
    api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"service_fee_gbp": 1500})
    stages = stages_of(db, job["id"])
    assert [(s.stripe_product_id, s.synced_amount_gbp) for s in stages] == [("prod_1", 300), ("prod_3", 1200)]
    assert [c[0] for c in stripe.calls] == ["price", "default", "price", "default"]


def test_an_edit_that_leaves_the_fee_alone_doesnt_call_stripe(api, marketing, job, stripe):
    stripe.calls.clear()
    api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"status": "closed"})
    assert stripe.calls == []


def test_a_stripe_outage_never_fails_the_save(api, db, marketing, caplog):
    app.dependency_overrides[jobs.stripe_client] = lambda: FakeStripe(fail=True)
    with caplog.at_level(logging.ERROR):
        res = api.post("/api/v1/jobs", headers=marketing, json=new_job(service_fee_gbp=1000, payment_stages=STAGES))
    assert res.status_code == 201
    assert db.get(Job, res.json()["data"]["id"]) is not None
    assert "stripe.pricing_sync_failed" in caplog.text


def test_the_manual_sync_reports_the_prices(api, db, marketing, job, stripe):
    for s in stages_of(db, job["id"]):
        s.stripe_product_id = s.stripe_price_id = None
    db.flush()
    res = api.post(f"/api/v1/jobs/{job['id']}/stripe-pricing/sync", headers=marketing)
    assert res.status_code == 200
    data = res.json()["data"]
    assert [set(d) for d in data] == [{"id", "order", "label", "stripe_product_id", "stripe_price_id", "synced_amount_gbp"}] * 2
    assert all(d["stripe_price_id"] for d in data)


def test_the_manual_sync_reports_stripe_failures(api, marketing, job):
    app.dependency_overrides[jobs.stripe_client] = lambda: FakeStripe(fail=True)
    res = api.post(f"/api/v1/jobs/{job['id']}/stripe-pricing/sync", headers=marketing)
    # Already in sync: nothing to call, so nothing fails.
    assert res.status_code == 200
    res = api.put(f"/api/v1/jobs/{job['id']}", headers=marketing, json={"service_fee_gbp": 2000})
    res = api.post(f"/api/v1/jobs/{job['id']}/stripe-pricing/sync", headers=marketing)
    assert (res.status_code, res.json()["error"]["code"]) == (502, "stripe_sync_failed")


def test_without_stripe_configured(api, db, marketing):
    app.dependency_overrides[jobs.stripe_client] = lambda: None
    created = api.post("/api/v1/jobs", headers=marketing, json=new_job(service_fee_gbp=1000, payment_stages=STAGES))
    assert created.status_code == 201
    res = api.post(f"/api/v1/jobs/{created.json()['data']['id']}/stripe-pricing/sync", headers=marketing)
    assert (res.status_code, res.json()["error"]["code"]) == (503, "stripe_not_configured")


def test_only_job_managers_sync(api, db, job):
    _, finance = as_role(db, Role.finance)
    assert api.post(f"/api/v1/jobs/{job['id']}/stripe-pricing/sync", headers=finance).status_code == 403


# --- audit -------------------------------------------------------------------


def test_job_writes_and_stripe_syncs_are_on_the_trail(api, db):
    actor, headers = as_role(db, Role.marketing)
    job = api.post("/api/v1/jobs", headers=headers, json=new_job(service_fee_gbp=1000, payment_stages=STAGES)).json()["data"]
    stage = stages_of(db, job["id"])[0]
    trail = list(db.scalars(select(AuditLog).where(AuditLog.entity_id == stage.id).order_by(AuditLog.created_at, AuditLog.id)))
    assert [(e.action, e.actor_id) for e in trail] == [("create", actor), ("update", actor)]
    assert trail[1].after["stripe_price_id"] == stage.stripe_price_id
    created = db.scalars(select(AuditLog).where(AuditLog.entity_type == "Job", AuditLog.entity_id == job["id"])).one()
    assert (created.action, created.actor_id) == ("create", actor)


def test_the_api_database_role_can_write_them(api, db, marketing):
    db.execute(text("SET LOCAL ROLE vertex_api"))
    try:
        created = api.post("/api/v1/jobs", headers=marketing, json=new_job(service_fee_gbp=1000, payment_stages=STAGES))
        edited = api.put(f"/api/v1/jobs/{created.json()['data']['id']}", headers=marketing, json={"payment_stages": [STAGES[0]]})
        deleted = api.delete(f"/api/v1/jobs/{created.json()['data']['id']}", headers=marketing)
    finally:
        db.execute(text("RESET ROLE"))
    assert (created.status_code, edited.status_code, deleted.status_code) == (201, 200, 200)


# --- sectors and positions (step 3.3) -----------------------------------------


def sectors_url(job_id: str) -> str:
    return f"/api/v1/jobs/{job_id}/sectors"


def test_marketing_attaches_a_sector_and_positions(api, db, marketing, job):
    res = api.post(sectors_url(job["id"]), headers=marketing, json={"sector": "Agriculture"})
    assert res.status_code == 201
    sector = res.json()["data"]
    assert (sector["job_id"], sector["sector"], sector["positions"]) == (job["id"], "Agriculture", [])
    assert ISO_Z.fullmatch(sector["created_at"])

    positions = f"{sectors_url(job['id'])}/{sector['id']}/positions"
    added = api.post(positions, headers=marketing, json={"title": "Grape Picker", "city": "Verona"})
    assert added.status_code == 201
    position = added.json()["data"]
    assert set(position) == {"id", "job_sector_id", "title", "city", "created_at", "updated_at"}
    assert (position["job_sector_id"], position["title"], position["city"]) == (sector["id"], "Grape Picker", "Verona")

    edited = api.patch(f"{positions}/{position['id']}", headers=marketing, json={"city": None}).json()["data"]
    assert (edited["title"], edited["city"]) == ("Grape Picker", None)
    renamed = api.patch(f"{positions}/{position['id']}", headers=marketing, json={"title": "Fruit Picker"}).json()["data"]
    assert renamed["title"] == "Fruit Picker"

    assert api.delete(f"{positions}/{position['id']}", headers=marketing).json() == {"data": {"id": position["id"]}}
    assert db.get(JobPosition, position["id"]) is None


def test_a_sector_is_attached_once(api, marketing, job):
    api.post(sectors_url(job["id"]), headers=marketing, json={"sector": "Hospitality"})
    dup = api.post(sectors_url(job["id"]), headers=marketing, json={"sector": "Hospitality"})
    assert (dup.status_code, dup.json()["error"]) == (409, {"code": "duplicate", "message": "This sector is already attached to this programme."})


@pytest.mark.parametrize("body", [{"sector": "Mining"}, {}, {"sector": "agriculture"}])
def test_only_canonical_sectors(api, marketing, job, body):
    assert api.post(sectors_url(job["id"]), headers=marketing, json=body).status_code == 422


@pytest.mark.parametrize(("method", "body"), [("post", {"title": "x"}), ("post", {"title": "Picker", "city": "c" * 101}), ("patch", {"title": None})])
def test_position_rules(api, db, marketing, job, method, body):
    sector = api.post(sectors_url(job["id"]), headers=marketing, json={"sector": "Agriculture"}).json()["data"]
    positions = f"{sectors_url(job['id'])}/{sector['id']}/positions"
    if method == "post":
        assert api.post(positions, headers=marketing, json=body).status_code == 422
    else:
        position = api.post(positions, headers=marketing, json={"title": "Picker"}).json()["data"]
        assert api.patch(f"{positions}/{position['id']}", headers=marketing, json=body).status_code == 422


def test_removing_a_sector_removes_its_positions(api, db, marketing, job):
    sector = api.post(sectors_url(job["id"]), headers=marketing, json={"sector": "Agriculture"}).json()["data"]
    position = api.post(f"{sectors_url(job['id'])}/{sector['id']}/positions", headers=marketing, json={"title": "Picker"}).json()["data"]
    res = api.delete(f"{sectors_url(job['id'])}/{sector['id']}", headers=marketing)
    assert (res.status_code, res.json()) == (200, {"data": {"id": sector["id"]}})
    assert db.get(JobSector, sector["id"]) is None and db.get(JobPosition, position["id"]) is None


def test_ids_must_belong_together(api, db, marketing, job):
    other = api.post("/api/v1/jobs", headers=marketing, json=new_job()).json()["data"]
    sector = api.post(sectors_url(job["id"]), headers=marketing, json={"sector": "Agriculture"}).json()["data"]
    position = api.post(f"{sectors_url(job['id'])}/{sector['id']}/positions", headers=marketing, json={"title": "Picker"}).json()["data"]

    assert api.post(sectors_url("cnosuchjob0000"), headers=marketing, json={"sector": "Agriculture"}).json()["error"]["message"] == "Job not found."
    wrong_job = api.delete(f"{sectors_url(other['id'])}/{sector['id']}", headers=marketing)
    assert (wrong_job.status_code, wrong_job.json()["error"]["message"]) == (404, "Sector not found on this programme.")
    other_sector = api.post(sectors_url(other["id"]), headers=marketing, json={"sector": "Hospitality"}).json()["data"]
    wrong_sector = api.patch(f"{sectors_url(other['id'])}/{other_sector['id']}/positions/{position['id']}", headers=marketing, json={"title": "Moved"})
    assert (wrong_sector.status_code, wrong_sector.json()["error"]["message"]) == (404, "Position not found on this sector.")
    assert db.get(JobPosition, position["id"]).title == "Picker"


def test_only_job_managers_manage_sectors(api, db, job):
    _, hr = as_role(db, Role.hr)
    assert api.post(sectors_url(job["id"]), headers=hr, json={"sector": "Agriculture"}).status_code == 403


def test_sector_and_position_writes_are_on_the_trail(api, db):
    actor, headers = as_role(db, Role.marketing)
    job = api.post("/api/v1/jobs", headers=headers, json=new_job()).json()["data"]
    sector = api.post(sectors_url(job["id"]), headers=headers, json={"sector": "Agriculture"}).json()["data"]
    position = api.post(f"{sectors_url(job['id'])}/{sector['id']}/positions", headers=headers, json={"title": "Picker"}).json()["data"]
    api.delete(f"{sectors_url(job['id'])}/{sector['id']}", headers=headers)

    def trail(entity_id):
        return [(e.action, e.actor_id) for e in db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.created_at, AuditLog.id))]

    assert trail(sector["id"]) == [("create", actor), ("delete", actor)]
    assert trail(position["id"]) == [("create", actor), ("delete", actor)]  # removed with its sector, still recorded

