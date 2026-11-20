import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { seg } from "@/lib/pipeline";

// GET /api/management/partners/:id/tracking: the partner tracking panel
// (Phase 6): onboarding, submissions by stage, reports, follow-ups and the
// activity feed. FastAPI answers (vertex_be/app/api/v1/partner_tracking.py)
// and keeps a virtual assistant to its own partners; the roles must match
// TRACKERS there (tests check it).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["virtual_assistant", "inhouse_supervisor", "director", "admin"]);
  if (guardRes) return guardRes;
  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/partners/${seg(id)}/tracking`));
}
