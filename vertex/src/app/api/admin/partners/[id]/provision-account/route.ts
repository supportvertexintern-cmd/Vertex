import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

const PARTNER_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// POST /api/admin/partners/:id/provision-account — same manager tier as
// the rest of Partner CRUD (create/status/MOU) creates the partner's own
// login (SRS FR-5.1). Replaces the old temp-password pattern (2026-07-27)
// with the same invite-email flow as POST /api/admin/users — the partner
// sets their own password rather than being handed one out of band.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  // FastAPI writes since users step 8.4 (vertex_be/app/api/v1/partner_agencies.py),
  // with the partner's row locked so two requests can't both give it a
  // login.
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/partners/${seg(id)}/provision-account`, { method: "POST", body: read.body });
}
