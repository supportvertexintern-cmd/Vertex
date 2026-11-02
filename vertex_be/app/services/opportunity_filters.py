"""The Country / Programme / Programme Country filters every list of an
opportunity shows (reads handover R4): the website's server/services/
opportunityFilters.ts, moved here. The caller says which jobs its records
use; the result is the options and a job filter it nests under its own
relation to Job.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, and_, select
from sqlalchemy.orm import Session

from app.models.identity import Country
from app.models.jobs import Job

_VARIANT = re.compile(r"\s*\([^)]*\)\s*$")


def programme_from_job_title(title: str) -> str:
    """"Belgium — Warehouse Programme (Credit Service)" -> "Warehouse
    Programme": a job has no programme field, its title carries it."""
    sep = title.find(" — ")
    rest = title[sep + 3:] if sep >= 0 else title
    return _VARIANT.sub("", rest).strip() or title


@dataclass(frozen=True)
class OpportunityParams:
    country: str | None = None
    programme: str | None = None
    programme_country: str | None = None

    @property
    def any(self) -> bool:
        return bool(self.country or self.programme or self.programme_country)


def _sorted_unique(values: list[str]) -> list[str]:
    """Sorted as JavaScript's localeCompare sorts plain names: by letters,
    ignoring case first."""
    return sorted({v for v in values if v}, key=lambda v: (v.casefold(), v))


def resolve(db: Session, jobs_in_use: ColumnElement[bool], params: OpportunityParams) -> tuple[dict[str, Any], ColumnElement[bool] | None]:
    """The filter options (every country in the system; the programmes and
    programme countries the records use) and a Job filter, None when no
    filter is set. A programme resolves to exact job ids, so one programme
    name can't match another that contains it."""
    used = list(db.execute(select(Job.id, Job.title, Job.country).where(jobs_in_use)))
    countries = list(db.scalars(select(Country.name)))
    options = {
        "countries": _sorted_unique(countries + [c for _, _, c in used]),
        "programmes": _sorted_unique([programme_from_job_title(t) for _, t, _ in used]),
        "programme_countries": _sorted_unique([c for _, _, c in used]),
    }
    conditions: list[ColumnElement[bool]] = []
    if params.country:
        conditions.append(Job.country == params.country)
    if params.programme_country:
        conditions.append(Job.country == params.programme_country)
    if params.programme:
        conditions.append(Job.id.in_([i for i, t, _ in used if programme_from_job_title(t) == params.programme]))
    return options, (and_(*conditions) if conditions else None)
