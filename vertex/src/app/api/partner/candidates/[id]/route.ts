import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole } from "@/lib/api-auth";

// GET /api/partner/candidates/:id — a partner's own detail view of one
// submission (SRS FR-5.1, 2026-07-31) — scoped to the caller's own
// Partner.id, same as the list endpoint; no visibility into any other
// agency's candidates.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  const partner = await prisma.partner.findUnique({ where: { user_id: user!.userId } });
  if (!partner) return NextResponse.json({ error: { code: "not_found", message: "Partner record not found." } }, { status: 404 });

  const { id } = await params;

  const candidate = await prisma.partnerCandidate.findUnique({
    where: { id },
    include: {
      job: {
        select: {
          id: true, title: true, country: true, city: true, service_fee_gbp: true, is_credit_service: true,
          payment_stages: { orderBy: { order: "asc" } },
        },
      },
      job_position: { select: { title: true, city: true, job_sector: { select: { sector: true } } } },
      current_location_country: { select: { name: true } },
      // Documents uploaded while this row was still a draft (2026-09-09) —
      // reparented onto bridged_candidate's own documents once submitted,
      // so this array is only ever populated pre-submission.
      documents: { select: { id: true, type: true, label: true, uploaded_at: true } },
      bridged_candidate: {
        select: {
          id: true,
          documents: { select: { id: true, type: true, verification_status: true, uploaded_at: true, label: true } },
        },
      },
    },
  });
  if (!candidate || candidate.partner_id !== partner.id) {
    return NextResponse.json({ error: { code: "not_found", message: "Submission not found." } }, { status: 404 });
  }

  return NextResponse.json({ data: candidate });
}

// PATCH /api/partner/candidates/:id — a partner correcting its own
// submission, or staff re-saving a draft they're entering; a bridged
// submission's candidate and application follow. Written by FastAPI since
// the pipeline switch (step 6.7; vertex_be/app/api/v1/partner_submissions.py).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partner/candidates/${seg(id)}`, { method: "PATCH", body: read.body });
}

// DELETE /api/partner/candidates/:id — a partner abandoning its own
// unfinished draft, with its files (FastAPI, as above). Answered as before.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return passOn(`/api/v1/partner/candidates/${seg(id)}`, { method: "DELETE" }, { unwrap: true, reshape: () => ({ message: "Draft deleted." }) });
}
