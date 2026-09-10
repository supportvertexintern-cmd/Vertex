import type { ReportCycle, Role } from "@prisma/client";

// Supervisory Reporting Framework §3-§5 — the specific KPI-row names for
// each role's Target-and-Performance table, per cycle. The Report
// content schema itself (src/lib/validations.ts) is generic/shared
// across every role; only these labels differ per §2.1's own framing
// (uniform sections, role-specific KPI names).
type RoleReportTemplates = Record<ReportCycle, string[]>;

export const REPORT_KPI_LABELS: Partial<Record<Role, RoleReportTemplates>> = {
  regional_recruiter: {
    daily: [
      "New candidates identified",
      "Candidates screened",
      "Candidates passed screening gate",
      "Candidates guided to apply",
      "Applications submitted",
      "Candidate follow-ups completed",
      "CRM records updated / corrected",
    ],
    weekly: [
      "Candidate identification",
      "Screening completion",
      "Screening pass rate",
      "Application submission",
      "CRM completeness / accuracy",
      "On-time follow-up",
    ],
    monthly: [
      "Candidates identified",
      "Candidates screened",
      "Qualified candidates",
      "Applications submitted",
      "Verified candidates",
      "CRM quality score",
      "Reporting timeliness",
    ],
  },
  country_supervisor: {
    daily: [
      "Active Regional Recruiters",
      "Daily recruiter submissions received",
      "New candidates entered",
      "Screening-gate compliance",
      "Applications submitted",
      "Incomplete / returned records",
      "Urgent candidate or operational issues",
    ],
    weekly: [
      "Active recruiters reporting",
      "Candidates identified",
      "Candidates screened",
      "Qualified candidates",
      "Applications submitted",
      "Verified candidate records",
      "CRM accuracy / completeness",
      "On-time regional reports",
    ],
    monthly: [
      "Candidates identified",
      "Candidates screened",
      "Qualified candidates",
      "Applications submitted",
      "Verified / approved candidates",
      "Average screening pass rate",
      "CRM data quality score",
      "Recruiter reporting compliance",
    ],
  },
  inhouse_supervisor: {
    // §5.1's Daily Management Exception Report is a per-country dashboard
    // + critical-exception table, not a named KPI table — represented via
    // the `activity`/`issues` sections instead (see ReportContentForm).
    daily: [],
    weekly: [
      "Countries reporting on time",
      "Active Regional Recruiters",
      "Candidates identified",
      "Candidates screened",
      "Applications submitted",
      "Verified candidates",
      "CRM quality score",
      "Open critical exceptions",
    ],
    monthly: [
      "Country reports received on time",
      "Recruiter network active",
      "Candidates identified",
      "Candidates screened",
      "Applications submitted",
      "Verified / approved candidates",
      "Portfolio data quality",
      "Critical issues closed on time",
    ],
  },
};

// Which optional sections each (role, cycle) combination actually shows,
// and what to call them — the underlying array shape is shared
// (label/detail/action/owner/due_date/status), only the presentation
// differs.
export interface ReportSectionConfig {
  activity?: { title: string; columns: { key: string; label: string }[] };
  pipeline?: { title: string };
  issues?: { title: string; columns: { key: string; label: string }[] };
  achievements?: { title: string };
  priorities?: { title: string };
  competencies?: { title: string };
}

export function getReportSections(role: Role, cycle: ReportCycle): ReportSectionConfig {
  const isRecruiter = role === "regional_recruiter";
  const isCountry = role === "country_supervisor";
  const isInhouse = role === "inhouse_supervisor";

  if (cycle === "daily") {
    if (isRecruiter) {
      return {
        activity: {
          title: "Candidate Activity",
          columns: [
            { key: "candidate_ref", label: "Candidate / CRM ID" },
            { key: "role", label: "Role" },
            { key: "current_status", label: "Current Status" },
            { key: "action_completed", label: "Action Completed Today" },
            { key: "next_action", label: "Next Action / Due Date" },
          ],
        },
        issues: { title: "Issue / Blocker", columns: ISSUE_COLUMNS },
      };
    }
    if (isCountry) {
      return {
        activity: {
          title: "Regional Recruiter Status",
          columns: [
            { key: "candidate_ref", label: "Regional Recruiter" },
            { key: "current_status", label: "Daily Status" },
            { key: "role", label: "Target vs Actual" },
            { key: "action_completed", label: "Data Quality" },
            { key: "next_action", label: "Supervisor Action" },
          ],
        },
        issues: { title: "Exception / Escalation", columns: ISSUE_COLUMNS },
      };
    }
    if (isInhouse) {
      return {
        activity: {
          title: "Country Status",
          columns: [
            { key: "candidate_ref", label: "Country" },
            { key: "current_status", label: "Dashboard Status" },
            { key: "role", label: "Target Risk" },
            { key: "action_completed", label: "Data / Compliance Risk" },
            { key: "next_action", label: "Decision / Direction Issued" },
          ],
        },
        issues: { title: "Critical Exception", columns: ISSUE_COLUMNS },
      };
    }
  }

  if (cycle === "weekly") {
    return {
      pipeline: { title: "Funnel Stage" },
      achievements: { title: "Top Achievement" },
      issues: { title: isRecruiter ? "Challenge / Risk" : "Material Issue / Risk", columns: ISSUE_COLUMNS },
      priorities: { title: isCountry || isInhouse ? "Decision / Support Required" : "Next-Week Priority" },
    };
  }

  // monthly
  return {
    competencies: isRecruiter ? { title: "Competency / Control Area" } : undefined,
    achievements: !isRecruiter ? { title: "Trend / Finding" } : undefined,
    priorities: { title: isRecruiter ? "Learning / Improvement Need" : "Next-Month Objective" },
  };
}

const ISSUE_COLUMNS = [
  { key: "label", label: "Issue" },
  { key: "detail", label: "Impact" },
  { key: "action", label: "Action Taken" },
  { key: "owner", label: "Support Required" },
  { key: "escalation", label: "Escalation?" },
];

export const OVERALL_STATUS_OPTIONS = [
  { value: "green", label: "Green — on target / controlled" },
  { value: "amber", label: "Amber — attention required / recoverable" },
  { value: "red", label: "Red — material exception / escalation required" },
  { value: "grey", label: "Grey — not started / not applicable" },
];
