"""The staff and partner test accounts (password TestPassword123! for all):
one per role, for manual testing on a development stack. Needs the reference
data (scripts/seed/reference.py). Safe to re-run.

    DATABASE_URL=... python -m scripts.seed.test_accounts     (from vertex_be/)
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from scripts.seed.common import first, hash_password, run, upsert

from app.models.enums import MouStatus, PartnerStatus, PartnerType, Role  # noqa: E402  (after common sets the path)
from app.models.identity import Country, InhouseCountryAssignment, User  # noqa: E402
from app.models.partners import Partner  # noqa: E402

PASSWORD = "TestPassword123!"  # gitleaks:allow  (a test account on a development stack)
STAFF = [
    ("admin@test.local", "Test Admin", Role.admin),
    ("director@test.local", "Test Director", Role.director),
    ("marketing@test.local", "Test Marketing", Role.marketing),
    ("hr@test.local", "Test HR", Role.hr),
    ("operations@test.local", "Test Operations", Role.operations_team),
    ("finance@test.local", "Test Finance", Role.finance),
]


def seed(db: Session) -> None:
    password_hash = hash_password(PASSWORD)
    kenya = first(db, Country, name="Kenya")
    if kenya is None:
        raise SystemExit("Kenya not found: run scripts.seed.reference against this database first.")

    def account(email: str, full_name: str, role: Role, **extra) -> User:
        return upsert(db, User, {"email": email}, {"role": role, "password_hash": password_hash, "email_verified": True, **extra}, {"full_name": full_name})

    supervisor = account("supervisor@test.local", "Test Supervisor", Role.country_supervisor, assigned_country_id=kenya.id)
    account("recruiter@test.local", "Test Recruiter", Role.regional_recruiter, assigned_country_id=kenya.id, supervisor_id=supervisor.id)
    inhouse = account("inhouse@test.local", "Test In-House Supervisor", Role.inhouse_supervisor)
    upsert(db, InhouseCountryAssignment, {"inhouse_supervisor_id": inhouse.id, "country_id": kenya.id})
    for email, full_name, role in STAFF:
        account(email, full_name, role)

    # A real Partner with a linked login, as the admin-provisioned flow ends up.
    login = account("partner@test.local", "Test Partner Agency", Role.partner)
    upsert(db, Partner, {"user_id": login.id}, {"status": PartnerStatus.active, "mou_status": MouStatus.signed}, {
        "name": "Test Partner Agency", "partner_type": PartnerType.manpower_supplier, "country_of_operation": "Kenya",
        "contact_name": "Test Partner Agency", "contact_email": "partner@test.local", "contact_phone": "N/A",
    })


if __name__ == "__main__":
    run(seed)
    print(f"Done. Password for all accounts: {PASSWORD}")
