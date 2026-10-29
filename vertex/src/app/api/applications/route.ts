import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { pipelineResponse, readJson } from "@/lib/pipeline";
import { isStaffRole } from "@/lib/rbac";
import { scopeCandidatesToRequester } from "@/server/scope";
import { getRequiredDocumentTypesForCountryIds } from "@/server/services/documentCompleteness";
import { rateLimit } from "@/lib/rate-limit";
import { signCifUploadToken } from "@/lib/jwt";
const MAX_PAGE_SIZE = 200;

// GET /api/applications — a candidate sees their own; every staff role
// sees applications scoped exactly like the candidate list itself (SRS
// FR-2.1 "guide and track applications" — a recruiter needs this for
// their own sourced candidates, not just admin). Reuses
// scopeCandidatesToRequester so the two views can never drift apart.
//
// The staff branch is paginated (page/pageSize, defaulting to page 1 /
// 50 rows even if the caller doesn't ask) — at 40-country/800-recruiter
// scale this was a fully unbounded findMany, returning every application
// a country/recruiter has ever had in one response. The candidate branch
// stays unbounded — a single candidate's own application count is small
// by construction, not something that grows with platform-wide volume.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  if (isStaffRole(user!.role)) {
    const candidateScope = await scopeCandidatesToRequester(user!);
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize")) || 50));
    const where = { candidate: candidateScope };

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: {
          candidate: {
            select: {
              full_name: true,
              documents: { select: { id: true, type: true, verification_status: true } },
              user: { select: { full_name: true, email: true } },
              recruiter: { select: { id: true, full_name: true } },
              country: { select: { id: true, name: true } },
            },
          },
          job: { select: { title: true, country: true, city: true } },
          preferred_country_1: { select: { name: true } },
          preferred_sector: { select: { name: true } },
        },
        orderBy: { submitted_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.application.count({ where }),
    ]);
    return NextResponse.json({ data: applications, total, page, pageSize });
  }

  // Candidate: find their own
  const candidate = await prisma.candidate.findUnique({ where: { user_id: user!.userId } });
  if (!candidate) return NextResponse.json({ applications: [] });

  const applications = await prisma.application.findMany({
    where: { candidate_id: candidate.id },
    include: {
      job: { select: { id: true, title: true, country: true, city: true, salary_range: true } },
      preferred_country_1: { select: { name: true } },
      preferred_sector: { select: { name: true } },
    },
    orderBy: { submitted_at: "desc" },
  });

  // Which document types this specific application needs (universal set
  // + its own destination country's extras) — lets the candidate's
  // dashboard show a per-application checklist instead of one flattened,
  // first-application-only list. Batched into one lookup regardless of
  // application count, rather than a query pair per application.
  // A job-linked application (the only kind created going forward,
  // 2026-07-31) has no preferred_country_1_id at all — resolve its
  // destination via Job.country against Vertex's admin-managed Country
  // rows by name (case-insensitive), same pattern as
  // documentCompleteness.ts's own job-linked resolution. Falls back to
  // preferred_country_1_id for historical applications that still have it.
  const jobCountryNames = [
    ...new Set(
      applications
        .filter((a: (typeof applications)[number]) => !a.preferred_country_1_id && a.job)
        .map((a: (typeof applications)[number]) => a.job!.country)
    ),
  ];
  const jobCountries = jobCountryNames.length
    ? await prisma.country.findMany({ where: { name: { in: jobCountryNames, mode: "insensitive" } }, select: { id: true, name: true } })
    : [];
  const jobCountryIdByName = new Map(jobCountries.map((c: (typeof jobCountries)[number]) => [c.name.toLowerCase(), c.id]));
  const countryIdFor = (app: (typeof applications)[number]) =>
    app.preferred_country_1_id ?? (app.job ? (jobCountryIdByName.get(app.job.country.toLowerCase()) ?? null) : null);

  const requiredByCountry = await getRequiredDocumentTypesForCountryIds(applications.map(countryIdFor));
  const withRequirements = applications.map((app: (typeof applications)[number]) => ({
    ...app,
    required_document_types: requiredByCountry.get(countryIdFor(app)) ?? requiredByCountry.get(null) ?? [],
  }));

  return NextResponse.json(withRequirements);
}

// POST /api/applications — the Candidate Information Form: the first thing
// anyone fills in, anonymously, as a signed-in candidate, or as staff for a
// lead. Written by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/applications.py, submit), which creates the
// candidate if needed, screens a self-applicant and lists the emails due.
// This app keeps limiting anonymous submissions, and signs the short-lived
// upload token that lets a self-applicant who passed screening attach
// documents before any account exists (FastAPI issues no tokens).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;

  if (!user) {
    const ip = req.headers.get("x-forwarded-for") ?? "unknown";
    const rl = rateLimit(`applications-new:${ip}`, { max: 5, windowMs: 60_000 });
    if (!rl.success) {
      return NextResponse.json({ error: "Too many submissions. Please try again later." }, { status: 429 });
    }
  }

  // An anonymous applicant has no session: FastAPI is called as this app,
  // with the user's session whenever there is one.
  const result = await callBackend("/api/v1/applications/submit", { method: "POST", body: read.body, asUser: "if-signed-in" });
  if (!result.ok && result.status === 402 && result.error.details) {
    // The form reads these to send the candidate to pay.
    return NextResponse.json({ error: result.error.message, ...(result.error.details as object) }, { status: 402 });
  }
  return pipelineResponse(result, {
    unwrap: true,
    legacyErrors: true,
    reshape: (data, body) => {
      const application = data as { candidate_id: string };
      const uploadToken = body.screening_passed ? signCifUploadToken(application.candidate_id) : undefined;
      return { ...application, upload_token: uploadToken };
    },
  });
}
