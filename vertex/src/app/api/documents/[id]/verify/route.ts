import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthUser, requireAuth, forbidden } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// Verification is a check performed on a candidate's documents —
// country_supervisor/inhouse_supervisor for the internal recruiter
// pipeline (the sourcing recruiter themselves is deliberately excluded to
// avoid self-verification), and hr for a partner-sourced submission
// (2026-07-31) — a rejection here is document-level only and never
// touches PartnerCandidate.status.
const VERIFIER_ROLES: Role[] = ["country_supervisor", "inhouse_supervisor", "director", "admin", "hr"];

// PATCH /api/documents/:id/verify — SRS FR-2.7. Written by FastAPI since
// the pipeline switch (step 6.7; vertex_be/app/api/v1/documents.py, verify).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;
  if (!VERIFIER_ROLES.includes(user!.role)) {
    return forbidden({ error: { code: "forbidden", message: "Not authorized to verify documents." } });
  }
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/documents/${seg(id)}/verify`, { method: "PATCH", body: read.body });
}
