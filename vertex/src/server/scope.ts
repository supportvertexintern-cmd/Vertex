import type { JwtPayload } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

/**
 * An In-House Supervisor can be assigned several countries (2026-07,
 * supersedes the earlier single-country design) — every call site that
 * used to read `assigned_country_id` for this role now goes through here
 * instead, so the `{ in: [...] }` lookup lives in one place.
 */
export async function getInhouseAssignedCountryIds(userId: string): Promise<string[]> {
  const assignments = await prisma.inhouseCountryAssignment.findMany({
    where: { inhouse_supervisor_id: userId },
    select: { country_id: true },
  });
  return assignments.map((a: (typeof assignments)[number]) => a.country_id);
}

/**
 * Row-level scoping (SRS FR-1.2 least privilege): every list/read of
 * candidate records goes through here rather than duplicating
 * "if role === X then where..." across route handlers.
 *
 * Fails closed — an unrecognized or unassigned state scopes to nothing,
 * never to everything.
 */
export async function scopeCandidatesToRequester(
  user: JwtPayload
): Promise<Prisma.CandidateWhereInput> {
  switch (user.role) {
    case "regional_recruiter":
      return { recruiter_id: user.userId };

    case "country_supervisor": {
      const supervisor = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { assigned_country_id: true },
      });
      return supervisor?.assigned_country_id
        ? { country_id: supervisor.assigned_country_id }
        : { id: "__none__" };
    }

    // In-House Supervisor can be assigned several countries (2026-07) —
    // narrows their scope to whichever ones, rather than treating them as
    // a global overseer like director/admin.
    case "inhouse_supervisor": {
      const countryIds = await getInhouseAssignedCountryIds(user.userId);
      return countryIds.length ? { country_id: { in: countryIds } } : { id: "__none__" };
    }

    case "director":
    case "admin":
      return {};

    // Separation-of-duties roles (2026-07-31) — global/unrestricted, per
    // the confirmed decision that HR/Operations/Finance aren't
    // country-scoped like the recruiter hierarchy. Applies to every
    // candidate/case regardless of source.
    case "hr":
    case "operations_team":
    case "operations_director":
    case "finance":
      return {};

    // A partner only ever sees candidates it bridged itself, never the
    // broader recruiter/supervisor-style access — needed for the Partner
    // Cases tab.
    case "partner": {
      const partner = await prisma.partner.findUnique({ where: { user_id: user.userId }, select: { id: true } });
      return partner ? { partner_id: partner.id } : { id: "__none__" };
    }

    case "candidate":
      return { user_id: user.userId };

    default:
      return { id: "__none__" };
  }
}

type CandidateAccessCheck = {
  user_id: string | null;
  recruiter_id: string | null;
  country_id: string | null;
  // Only populated by call sites that might actually be reached by a
  // partner (currently just /api/upload, for a partner attaching real
  // documents to a candidate they just bridged) — optional so every other
  // existing call site's select doesn't need to change.
  partner_id?: string | null;
};

/**
 * Single-record authorization check for anything scoped to a candidate
 * (documents, cases, etc. in later phases). Mirrors scopeCandidatesToRequester
 * but for the "can this requester touch this one record" case.
 */
export async function canAccessCandidate(
  user: JwtPayload,
  candidate: CandidateAccessCheck
): Promise<boolean> {
  switch (user.role) {
    case "candidate":
      return candidate.user_id === user.userId;

    case "regional_recruiter":
      return candidate.recruiter_id === user.userId;

    case "country_supervisor": {
      if (!candidate.country_id) return false;
      const supervisor = await prisma.user.findUnique({
        where: { id: user.userId },
        select: { assigned_country_id: true },
      });
      return supervisor?.assigned_country_id === candidate.country_id;
    }

    case "inhouse_supervisor": {
      if (!candidate.country_id) return false;
      const countryIds = await getInhouseAssignedCountryIds(user.userId);
      return countryIds.includes(candidate.country_id);
    }

    case "director":
    case "admin":
      return true;

    // Separation-of-duties roles (2026-07-31) — unrestricted, mirroring
    // scopeCandidatesToRequester above.
    case "hr":
    case "operations_team":
    case "operations_director":
    case "finance":
      return true;

    // A partner never gets its own recruiter/supervisor-style broad access
    // — only to a candidate it actually sourced (bridged from its own
    // PartnerCandidate submission), scoped by the caller's own Partner row.
    case "partner": {
      if (!candidate.partner_id) return false;
      const partner = await prisma.partner.findUnique({ where: { user_id: user.userId }, select: { id: true } });
      return partner?.id === candidate.partner_id;
    }

    default:
      return false;
  }
}

/**
 * Single-record check for a Document. A document uploaded while its
 * PartnerCandidate was still a draft has no Candidate yet (only
 * partner_candidate_id), so canAccessCandidate can't decide it: only the
 * owning partner and the staff who enter drafts on a partner's behalf may
 * see it. Anything else is refused.
 */
export async function canAccessDocument(
  user: JwtPayload,
  document: { candidate: CandidateAccessCheck | null; partner_candidate_id: string | null }
): Promise<boolean> {
  if (document.candidate) return canAccessCandidate(user, document.candidate);
  if (!document.partner_candidate_id) return false;
  switch (user.role) {
    case "admin":
    case "director":
    case "hr":
    case "operations_team":
    case "operations_director":
      return true;
    case "partner": {
      const draft = await prisma.partnerCandidate.findUnique({
        where: { id: document.partner_candidate_id },
        select: { partner: { select: { user_id: true } } },
      });
      return draft?.partner.user_id === user.userId;
    }
    default:
      return false;
  }
}

/**
 * Row-level scoping for Cases (SRS FR-4.2), derived through the existing
 * candidate scope rather than duplicating recruiter_id/country_id onto
 * Case itself — a case is always reached via application -> candidate.
 */
export async function scopeCasesToRequester(user: JwtPayload): Promise<Prisma.CaseWhereInput> {
  const candidateScope = await scopeCandidatesToRequester(user);
  return { application: { candidate: candidateScope } };
}

/**
 * Single-record authorization check for a Case — mirrors canAccessCandidate.
 */
export async function canAccessCase(
  user: JwtPayload,
  candidate: CandidateAccessCheck
): Promise<boolean> {
  return canAccessCandidate(user, candidate);
}
