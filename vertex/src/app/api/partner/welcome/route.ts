import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// POST /api/partner/welcome — whether the partner portal shows its first-time
// welcome. FastAPI answers show: true once, the first time it's asked after
// the login's first sign-in activated it, and false from then on
// (vertex_be/app/api/v1/partner_submissions.py, owner's requirement 2026-11-07).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/partner/welcome", { method: "POST" }));
}
