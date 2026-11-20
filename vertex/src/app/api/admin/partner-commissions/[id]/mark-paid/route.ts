import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";

// POST /api/admin/partner-commissions/:id/mark-paid: approved -> paid, with an optional receipt; the partner is emailed (Phase 6). Directors
// and admins only; a month that hasn't started is refused. FastAPI writes it
// (vertex_be/app/api/v1/partner_ledgers.py); the roles must match PAYERS there.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["admin", "director"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  const body: unknown = await req.json().catch(() => ({}));
  return passOn(`/api/v1/partner-commissions/${seg(id)}/mark-paid`, { method: "POST", body });
}
