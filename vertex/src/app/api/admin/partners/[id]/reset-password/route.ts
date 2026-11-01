import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";

const PARTNER_MANAGER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;

// POST /api/admin/partners/:id/reset-password (2026-08-01) — same manager
// tier as the rest of Partner CRUD. Unlike staff password resets
// (POST /api/admin/users/:id/reset-password, which hands back a one-time
// temp password shown in the UI), a partner gets the same set-your-own-
// password invite email used at initial provisioning: password_hash is
// cleared so the old password stops working immediately, and the partner
// sets a new one themselves via the link.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...PARTNER_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;

  // FastAPI writes since users step 8.4 (vertex_be/app/api/v1/partner_agencies.py).
  return passOn(`/api/v1/partners/${seg(id)}/reset-password`, { method: "POST" });
}
