"""The KPI-table row labels each staff role's report uses per cycle: a copy
of REPORT_KPI_LABELS in vertex/src/lib/reportTemplates.ts (Supervisory
Reporting Framework). A staff KPI target is keyed to one of these labels, so
FastAPI checks it against the same list; tests/test_targets.py fails if the
two copies differ in any role, cycle or label."""

from __future__ import annotations

from app.models.enums import ReportCycle, Role

REPORT_KPI_LABELS: dict[Role, dict[ReportCycle, tuple[str, ...]]] = {
    Role.regional_recruiter: {
        ReportCycle.daily: (
            "New candidates identified",
            "Candidates screened",
            "Candidates passed screening gate",
            "Candidates guided to apply",
            "Applications submitted",
            "Candidate follow-ups completed",
            "CRM records updated / corrected",
        ),
        ReportCycle.weekly: (
            "Candidate identification",
            "Screening completion",
            "Screening pass rate",
            "Application submission",
            "CRM completeness / accuracy",
            "On-time follow-up",
        ),
        ReportCycle.monthly: (
            "Candidates identified",
            "Candidates screened",
            "Qualified candidates",
            "Applications submitted",
            "Verified candidates",
            "CRM quality score",
            "Reporting timeliness",
        ),
    },
    Role.country_supervisor: {
        ReportCycle.daily: (
            "Active Regional Recruiters",
            "Daily recruiter submissions received",
            "New candidates entered",
            "Screening-gate compliance",
            "Applications submitted",
            "Incomplete / returned records",
            "Urgent candidate or operational issues",
        ),
        ReportCycle.weekly: (
            "Active recruiters reporting",
            "Candidates identified",
            "Candidates screened",
            "Qualified candidates",
            "Applications submitted",
            "Verified candidate records",
            "CRM accuracy / completeness",
            "On-time regional reports",
        ),
        ReportCycle.monthly: (
            "Candidates identified",
            "Candidates screened",
            "Qualified candidates",
            "Applications submitted",
            "Verified / approved candidates",
            "Average screening pass rate",
            "CRM data quality score",
            "Recruiter reporting compliance",
        ),
    },
    Role.inhouse_supervisor: {
        ReportCycle.daily: (),
        ReportCycle.weekly: (
            "Countries reporting on time",
            "Active Regional Recruiters",
            "Candidates identified",
            "Candidates screened",
            "Applications submitted",
            "Verified candidates",
            "CRM quality score",
            "Open critical exceptions",
        ),
        ReportCycle.monthly: (
            "Country reports received on time",
            "Recruiter network active",
            "Candidates identified",
            "Candidates screened",
            "Applications submitted",
            "Verified / approved candidates",
            "Portfolio data quality",
            "Critical issues closed on time",
        ),
    },
}
