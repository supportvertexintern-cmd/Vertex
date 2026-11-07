"""The seeds (scripts/seed, the website's until reads handover R8): each runs
twice without duplicating anything, and what it creates works. They were
checked against the Prisma seeds' output, row for row, when they moved."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.models.candidate import Application, Candidate
from app.models.cases import Case, CasePayment
from app.models.enums import ApplicationStatus, CandidateLifecycleStatus, CandidateSource, MouStatus, PartnerStatus, Role
from app.models.identity import Country, InhouseCountryAssignment, Region, User
from app.models.jobs import Job, JobPaymentStage, JobPosition, JobSector
from app.models.partners import Partner, PartnerCandidate
from app.models.reference import CountryDocumentRequirement, DocumentRequirementType, Sector, SystemSetting
from app.services.documents import PAYMENT_RECEIPT_TYPE_PREFIX
from app.services.sessions import check_password
from scripts.seed import demo, e2e, first_admin, partner_logins, partners, reference, test_accounts


def count(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


def counts(db) -> dict[str, int]:
    return {m.__name__: count(db, m) for m in (
        Region, Country, Sector, CountryDocumentRequirement, DocumentRequirementType, Job, JobPaymentStage, JobSector, JobPosition,
    )}


@pytest.fixture
def seeded(db):
    reference.seed(db)
    return db


def test_the_reference_data_loads_and_a_rerun_adds_nothing(seeded):
    before = counts(seeded)
    assert before["Job"] >= len(reference.DATA["JOBS"]) + len(reference.DATA["CREDIT_SERVICE_JOBS"])
    reference.seed(seeded)
    assert counts(seeded) == before


def test_a_rerun_keeps_what_an_admin_edited(seeded):
    title = reference.DATA["JOBS"][0]["title"]
    job = seeded.scalar(select(Job).where(Job.title == title))
    stage = seeded.scalars(select(JobPaymentStage).where(JobPaymentStage.job_id == job.id)).first()
    stage.label = "Edited by an admin"
    job.city = "Edited city"
    seeded.flush()
    reference.seed(seeded)
    seeded.refresh(stage)
    seeded.refresh(job)
    assert (stage.label, job.city) == ("Edited by an admin", "Edited city")  # city isn't among what a reseed sets


def test_every_stage_has_its_receipt_type_and_each_plan_totals_100(seeded):
    for job in seeded.scalars(select(Job).where(Job.title.in_([j["title"] for j in reference.DATA["JOBS"] + reference.DATA["CREDIT_SERVICE_JOBS"]]))):
        stages = seeded.scalars(select(JobPaymentStage).where(JobPaymentStage.job_id == job.id)).all()
        assert sum(s.percent for s in stages) == pytest.approx(100), job.title
        for stage in stages:
            assert seeded.scalar(select(DocumentRequirementType).where(DocumentRequirementType.key == f"{PAYMENT_RECEIPT_TYPE_PREFIX}{stage.id}"))


def test_the_programmes_keep_their_listed_order(seeded):
    """Each has its own created_at, though one transaction wrote them all."""
    titles = [j["title"] for j in reference.DATA["JOBS"] + reference.DATA["CREDIT_SERVICE_JOBS"]]
    listed = seeded.scalars(select(Job.title).where(Job.title.in_(titles)).order_by(Job.created_at)).all()
    assert listed == titles


def test_the_position_catalog_replaces_the_default_position(seeded):
    title, sectors = next(iter(reference.DATA["PDF_POSITIONS_BY_JOB_TITLE"].items()))
    job = seeded.scalar(select(Job).where(Job.title == title))
    positions = seeded.scalars(select(JobPosition.title).join(JobSector).where(JobSector.job_id == job.id)).all()
    assert reference.DEFAULT_POSITION_TITLE not in positions
    assert sectors[0]["positions"][0]["title"] in positions


def test_the_test_accounts_sign_in_and_a_rerun_adds_nothing(seeded):
    test_accounts.seed(seeded)
    users = count(seeded, User)
    test_accounts.seed(seeded)
    assert count(seeded, User) == users
    admin = seeded.scalar(select(User).where(User.email == "admin@test.local"))
    assert admin.role == Role.admin and check_password(test_accounts.PASSWORD, admin.password_hash)
    recruiter = seeded.scalar(select(User).where(User.email == "recruiter@test.local"))
    assert recruiter.supervisor_id == seeded.scalar(select(User.id).where(User.email == "supervisor@test.local"))
    partner = seeded.scalar(select(Partner).where(Partner.contact_email == "partner@test.local"))
    assert (partner.status, partner.mou_status) == (PartnerStatus.active, MouStatus.signed)
    inhouse = seeded.scalar(select(User.id).where(User.email == "inhouse@test.local"))
    assert seeded.scalar(select(InhouseCountryAssignment).where(InhouseCountryAssignment.inhouse_supervisor_id == inhouse))


def test_the_partner_logins_sign_in_as_their_own_agency_and_a_rerun_adds_nothing(seeded):
    result = partner_logins.seed(seeded)
    assert result["listed agencies with logins"] == len(partners.PARTNERS)
    before = (count(seeded, User), count(seeded, Partner), count(seeded, PartnerCandidate))
    partner_logins.seed(seeded)
    assert (count(seeded, User), count(seeded, Partner), count(seeded, PartnerCandidate)) == before

    emails = [partner_logins.login_email(p["company"]) for p in partners.PARTNERS]
    assert len(set(emails)) == len(emails)
    for p in partners.PARTNERS:
        agency = seeded.scalar(select(Partner).where(Partner.contact_email == p["email"]))
        login = seeded.get(User, agency.user_id)
        assert login.email == partner_logins.login_email(p["company"]) != p["email"]
        assert login.role == Role.partner and check_password(test_accounts.PASSWORD, login.password_hash)
        assert (agency.status, agency.mou_status) == (PartnerStatus.active, MouStatus.signed)

    invented = seeded.scalar(select(Partner).where(Partner.name == "Test Atlas Placements"))
    drafts = seeded.scalars(select(PartnerCandidate).where(PartnerCandidate.partner_id == invented.id)).all()
    assert sorted(c.status.value for c in drafts) == ["draft", "rejected", "submitted", "under_review"]
    assert all((c.submitted_at is None) == (c.status.value == "draft") for c in drafts)


def test_the_first_admin_signs_in_and_a_rerun_keeps_its_password(db):
    admin = first_admin.seed(db, "first@stack.test", "the-first-password")
    assert admin.role == Role.admin and admin.email_verified
    assert check_password("the-first-password", admin.password_hash)
    again = first_admin.seed(db, "first@stack.test", "another-password")
    assert again.id == admin.id and check_password("the-first-password", again.password_hash)
    assert db.scalar(select(func.count()).select_from(User).where(User.email == "first@stack.test")) == 1


def test_the_test_accounts_need_the_reference_data(db):
    if db.scalar(select(Country).where(Country.name == "Kenya")):
        pytest.skip("this database already has the reference data")
    with pytest.raises(SystemExit, match="scripts.seed.reference"):
        test_accounts.seed(db)


def test_the_partners_are_pending_with_no_login_and_a_rerun_skips_them(db):
    assert partners.seed(db) == len(partners.PARTNERS)
    assert partners.seed(db) == 0
    first = partners.PARTNERS[0]
    row = db.scalar(select(Partner).where(Partner.contact_email == first["email"]))
    assert (row.name, row.status, row.mou_status, row.user_id, row.contact_phone) == (first["company"], PartnerStatus.pending, MouStatus.none, None, "N/A")


def test_the_e2e_fixtures_are_built_and_swept_up_leaving_the_rest(seeded):
    test_accounts.seed(seeded)
    users = count(seeded, User)
    e2e.setup(seeded)
    e2e.setup(seeded)
    assert seeded.get(SystemSetting, "intake_mode").value == "crm"
    login = seeded.scalar(select(User).where(User.email == "e2e-case-candidate@test.local"))
    assert check_password(e2e.PASSWORD, login.password_hash)
    candidate = seeded.scalar(select(Candidate).where(Candidate.user_id == login.id))
    assert candidate.lifecycle_status == CandidateLifecycleStatus.verified
    assert seeded.scalar(select(Application).where(Application.candidate_id == candidate.id)).application_status == ApplicationStatus.submitted

    recruiter = seeded.scalar(select(User.id).where(User.email == "e2e-recruiter@test.local"))
    swept = Candidate(full_name="Recruited in a journey", recruiter_id=recruiter)
    agency = Partner(name=e2e.PARTNER, partner_type="manpower_supplier", country_of_operation="Kenya", contact_name="C", contact_email="p@test.invalid", contact_phone="1")
    seeded.add_all([swept, agency])
    seeded.flush()
    seeded.add(PartnerCandidate(partner_id=agency.id, full_name="Submitted in a journey"))
    seeded.flush()

    e2e.teardown(seeded)
    seeded.expire_all()
    assert count(seeded, User) == users  # the plain @test.local accounts stay
    assert seeded.scalar(select(Job).where(Job.title == e2e.JOB)) is None
    assert seeded.scalar(select(Country).where(Country.name == "E2E Country")) is None
    assert seeded.scalar(select(Candidate).where(Candidate.full_name == "Recruited in a journey")) is None
    assert seeded.scalar(select(Partner).where(Partner.name == e2e.PARTNER)) is None


def test_the_e2e_lookups_and_the_invite_shortcut(db):
    candidate = Candidate(full_name="Journey Candidate", source=CandidateSource.self_registered)
    db.add(candidate)
    db.flush()
    assert e2e.candidate(db, "Journey Candidate") == {
        "id": candidate.id, "source": "self_registered", "recruiter_id": None, "lifecycle_status": candidate.lifecycle_status.value, "has_case": False,
    }
    e2e.claim(db, "Journey Candidate", "e2e-journey@test.local", "A-password-1")
    db.refresh(candidate)
    user = db.scalar(select(User).where(User.email == "e2e-journey@test.local"))
    assert (candidate.user_id, candidate.lifecycle_status) == (user.id, CandidateLifecycleStatus.guided_to_apply)
    assert check_password("A-password-1", user.password_hash) and user.email_verified
    job = Job(title="J", country="K", city="N", job_description="d", requirements="r", application_fee=0)
    db.add(job)
    db.flush()
    application = Application(candidate_id=candidate.id, job_id=job.id)
    db.add(application)
    db.flush()
    db.add(Case(application_id=application.id))
    db.flush()
    assert e2e.candidate(db, "Journey Candidate")["has_case"] is True
    assert e2e.partner_login(db, "nobody@test.invalid") == {"user_id": None}
    with pytest.raises(SystemExit, match="No candidate"):
        e2e.candidate(db, "Nobody")


@pytest.mark.parametrize("url", ["postgresql://u:p@db.example.com/x", "postgresql://u:p@ep-1.aws.neon.tech/x", "not a url"])
def test_the_e2e_fixtures_refuse_anything_but_a_local_database(url):
    with pytest.raises(SystemExit, match="non-local"):
        e2e.assert_local_database(url)


def test_the_e2e_fixtures_accept_a_local_database():
    e2e.assert_local_database("postgresql://postgres@localhost:15437/vertex_e2e")


def test_the_demo_data_refuses_a_database_with_a_real_user(seeded):
    seeded.add(User(full_name="Real", email="someone@company.invalid", role=Role.candidate))
    seeded.flush()
    with pytest.raises(SystemExit, match="Refusing"):
        demo.seed(seeded)


def test_the_demo_needs_its_flag_and_a_file_outside_the_repo(monkeypatch):
    monkeypatch.delenv("DEMO_SEED", raising=False)
    with pytest.raises(SystemExit, match="DEMO_SEED"):
        demo.main()
    monkeypatch.setenv("DEMO_SEED", "yes")
    monkeypatch.delenv("DEMO_ACCOUNTS_FILE", raising=False)
    with pytest.raises(SystemExit, match="DEMO_ACCOUNTS_FILE"):
        demo.main()


def test_the_demo_data_has_a_journey_and_no_real_address(db):
    real = db.scalar(select(func.count()).select_from(User).where(User.email.not_like(f"%{demo.DOMAIN}")))
    if real:
        pytest.skip("this database has other users")
    reference.seed(db)
    lines = demo.seed(db)
    assert len(lines) == len(demo.STAFF) + 1 + len(demo.CANDIDATES)
    assert demo.seed(db) == []  # already loaded
    assert count(db, Case) == 3 and count(db, CasePayment) == 3
    assert not db.scalars(select(User.email).where(User.email.not_like(f"%{demo.DOMAIN}"))).all()
