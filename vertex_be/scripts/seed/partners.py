"""The partner agencies from "Parters Lists Final.docx" (2026-08-01), as
pending rows with no login, so no invite goes out: the director sends each
from "Create Partner Login" when ready. The source has no phone or partner
type, so "N/A" and manpower_supplier stand in, to correct per partner. An
agency already there (by contact email) is skipped.

    DATABASE_URL=... python -m scripts.seed.partners     (from vertex_be/)
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from scripts.seed.common import HERE, first, run

from app.models.enums import MouStatus, PartnerStatus, PartnerType  # noqa: E402  (after common sets the path)
from app.models.partners import Partner  # noqa: E402

PARTNERS = json.loads((HERE / "partners_data.json").read_text(encoding="utf-8"))


def seed(db: Session) -> int:
    created = 0
    for p in PARTNERS:
        if first(db, Partner, contact_email=p["email"]) is None:
            db.add(Partner(
                name=p["company"], partner_type=PartnerType.manpower_supplier, country_of_operation=p["country"], contact_name=p["contact"],
                contact_email=p["email"], contact_phone="N/A", status=PartnerStatus.pending, mou_status=MouStatus.none,
            ))
            db.flush()
            created += 1
    return created


if __name__ == "__main__":
    print(f"Done: {run(seed)} created, of {len(PARTNERS)}.")
