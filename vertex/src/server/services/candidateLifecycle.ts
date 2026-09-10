import type { Role, CandidateSource } from "@prisma/client";

export type LifecycleStatus =
  | "identified"
  | "screened"
  | "guided_to_apply"
  | "submitted"
  | "reported"
  | "verified"
  | "approved"
  | "rejected";

// "rejected" is deliberately not in this list (2026-08-06) — it's a
// terminal side-branch reachable from more than one point (identified,
// submitted), not a position on the linear identified→approved track, so
// it can't be meaningfully compared by index the way every other status
// here is. canSetLifecycleStatus special-cases it before doing any
// index-based isReturn arithmetic.
export const STATUS_ORDER: LifecycleStatus[] = [
  "identified",
  "screened",
  "guided_to_apply",
  "submitted",
  "reported",
  "verified",
  "approved",
];

// A recruiter drives a candidate up to and including "reported" — the
// hand-off point to their supervisor (SRS FR-2.1). A supervisor picks up
// from "reported" onward, or returns a candidate to an earlier stage for
// correction (FR-2.7).
const RECRUITER_MAX_STATUS: LifecycleStatus = "reported";
const SUPERVISOR_MIN_STATUS: LifecycleStatus = "reported";

// Country Supervisor's ceiling is "Verified" (Candidate Status Lifecycle
// stage 6, Regional Supervisory Operational Workflow p.5) — "Approved"
// (stage 7) is explicitly In-House Supervisor's controlling position
// ("Approved by In-House"), not a country-tier action.
const IN_HOUSE_ROLES: Role[] = ["inhouse_supervisor", "director"];

export interface TransitionCheck {
  allowed: boolean;
  reason?: string;
  isReturn: boolean;
}

/**
 * Role-gated lifecycle transition rules (SRS FR-2.4, FR-2.5, FR-2.7).
 * Screening-gate evaluation for the screened transition happens
 * separately (server/services/screening.ts) — this only decides whether
 * the requester's role may attempt the move at all.
 *
 * guided_to_apply and submitted are both system-only forward transitions
 * now — the Candidate Information Form is screened *before* an account
 * exists, so "guided to apply" really means "has claimed their invite and
 * created an account" (fired from /api/auth/register) and "submitted"
 * means "required documents are uploaded" (fired from /api/upload), not
 * something staff manually advance to.
 *
 * `source` (2026-07-31) is only meaningful for the `hr` branch below — a
 * self-submitted candidate (source: self_registered) never enters the
 * recruiter/country_supervisor/inhouse_supervisor pipeline at all; HR owns
 * its approval end-to-end instead, skipping reported/verified entirely.
 * Every other role's rules are unaffected by source and can omit it.
 */
export function canSetLifecycleStatus(role: Role, from: LifecycleStatus, to: LifecycleStatus, source?: CandidateSource): TransitionCheck {
  if (from === "rejected") {
    return { allowed: false, reason: "Candidate has already been rejected — this is a terminal state.", isReturn: false };
  }

  // Handled before any STATUS_ORDER index arithmetic — "rejected" isn't on
  // that track at all (see the STATUS_ORDER comment above), so comparing
  // its (nonexistent, -1) index against `from` would misclassify it as a
  // return for every real `from`.
  if (to === "rejected") {
    if (role !== "hr" && role !== "admin") {
      return { allowed: false, reason: "Only HR can reject a self-submitted candidate.", isReturn: false };
    }
    if (source !== "self_registered") {
      return { allowed: false, reason: "HR only manages self-submitted candidates.", isReturn: false };
    }
    if (from !== "identified" && from !== "submitted") {
      return { allowed: false, reason: "A candidate can only be rejected before or after document submission.", isReturn: false };
    }
    return { allowed: true, isReturn: false };
  }

  const fromIdx = STATUS_ORDER.indexOf(from);
  const toIdx = STATUS_ORDER.indexOf(to);
  const isReturn = toIdx < fromIdx;

  if (toIdx === fromIdx) {
    return { allowed: false, reason: "Candidate is already in that status.", isReturn: false };
  }

  if (role === "admin") {
    return { allowed: true, isReturn };
  }

  if (role === "hr") {
    if (source !== "self_registered") {
      return { allowed: false, reason: "HR only manages self-submitted candidates.", isReturn: false };
    }
    if (from === "identified" && to === "screened") return { allowed: true, isReturn: false };
    if (from === "submitted" && to === "approved") return { allowed: true, isReturn: false };
    // Request Revision / Return (2026-08-06) — sends a candidate whose
    // uploaded documents need fixing back to "awaiting document upload"
    // rather than rejecting them outright; they keep the account they
    // already created, just re-upload from the same dashboard.
    if (from === "submitted" && to === "guided_to_apply") return { allowed: true, isReturn: true };
    return {
      allowed: false,
      reason: "HR can only approve a self-submitted candidate for account creation, approve it once submitted, or return it for revision.",
      isReturn: false,
    };
  }

  if (role === "regional_recruiter") {
    if (isReturn) {
      return { allowed: false, reason: "Recruiters cannot move a candidate backward — only a supervisor can return one.", isReturn };
    }
    if (from === "screened" && to === "guided_to_apply") {
      return {
        allowed: false,
        reason: "Account creation happens automatically once the candidate claims their emailed invite link — there's nothing to manually advance here.",
        isReturn,
      };
    }
    if (from === "guided_to_apply" && to === "submitted") {
      return {
        allowed: false,
        reason: "Submission happens automatically once the candidate's required documents are uploaded.",
        isReturn,
      };
    }
    if (toIdx > STATUS_ORDER.indexOf(RECRUITER_MAX_STATUS)) {
      return { allowed: false, reason: "Only a supervisor can verify or approve a candidate.", isReturn };
    }
    return { allowed: true, isReturn };
  }

  if (IN_HOUSE_ROLES.includes(role)) {
    if (!isReturn && fromIdx < STATUS_ORDER.indexOf(SUPERVISOR_MIN_STATUS)) {
      return { allowed: false, reason: "A candidate must be reported by a recruiter before a supervisor can act on it.", isReturn };
    }
    return { allowed: true, isReturn };
  }

  if (role === "country_supervisor") {
    if (from === "approved" || to === "approved") {
      return { allowed: false, reason: "Only In-House can approve a candidate, or reverse an approval.", isReturn };
    }
    if (!isReturn && fromIdx < STATUS_ORDER.indexOf(SUPERVISOR_MIN_STATUS)) {
      return { allowed: false, reason: "A candidate must be reported by a recruiter before a supervisor can act on it.", isReturn };
    }
    return { allowed: true, isReturn };
  }

  return { allowed: false, reason: "This role cannot update candidate status.", isReturn };
}
