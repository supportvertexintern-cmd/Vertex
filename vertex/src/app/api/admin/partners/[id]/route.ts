import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { passOn, readJson, seg } from "@/lib/pipeline";

const PARTNER_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// Read from FastAPI since reads handover R2. A recruiter or country
// supervisor sees only the partner's candidates in their own scope (policy
// Q1, owner's decision 2026-11-02). Roles must match PARTNER_DETAIL_READERS
// in vertex_be/app/api/v1/partner_agencies.py (tests check it).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/partners/${seg(id)}`));
}

// PATCH /api/admin/partners/:id — every editable field goes through here
// (name, type, country, contact details, status, MOU, notes). Marking
// mou_status "signed" auto-stamps mou_signed_at rather than requiring the
// caller to also supply a timestamp.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  // FastAPI writes since users step 8.4 (vertex_be/app/api/v1/partner_agencies.py),
  // with the partner's row locked.
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partners/${seg(id)}`, { method: "PATCH", body: read.body });
}

// DELETE /api/admin/partners/:id — blocked if the partner has any real
// activity on file (bridged Candidates or PartnerCandidate submissions)
// rather than silently cascading it away — PartnerCandidate.partner_id is
// onDelete: Cascade in the schema, so an unblocked delete here would
// permanently destroy those submission records. A partner with a login
// has that login removed too, since an orphaned partner-role account with
// no Partner row behind it has nothing to sign in to. FastAPI deletes since
// users step 8.4.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return passOn(`/api/v1/partners/${seg(id)}`, { method: "DELETE" });
}
