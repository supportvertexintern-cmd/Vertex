import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { pipelineResponse, queryOf } from "@/lib/pipeline";

// GET /api/admin/users?role=&q= — staff directory for role/supervisor/country
// assignment (SRS FR-1.1, FR-1.3, FR-1.4). With no query, staff roles only;
// a text search (q) searches every user, including candidates, so an admin
// can find and promote one into the agent network. An explicit role param
// always narrows to that role regardless of q. Director has read-only
// access too, for the Supervisory Performance Scorecard (§7); creating and
// editing stays admin-only. Read from FastAPI since reads handover R6
// (vertex_be/app/api/v1/payment_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["admin", "director"]);
  if (guardRes) return guardRes;

  return backendResponse(await callBackend("/api/v1/users", { query: queryOf(req, ["role", "q"]) }));
}

// POST /api/admin/users — admin creates a brand-new staff account directly
// (rather than requiring self-registration + promotion). Replaces the old
// "temp password shown once" pattern (2026-07-27): the account is created
// with no password set, and an invite email lets the new staff member set
// their own — same shape as the candidate self-registration invite.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  // FastAPI creates the account since users step 8.3
  // (vertex_be/app/api/v1/users.py) and lists the setup email, sent from
  // here.
  const result = await callBackend("/api/v1/users", { method: "POST", body });
  return pipelineResponse(result);
}
