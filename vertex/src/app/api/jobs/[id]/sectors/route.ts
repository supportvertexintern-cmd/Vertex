import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns a programme's sectors and positions since backend plan step
// 3.3 (vertex_be/app/api/v1/jobs.py): this handler checks the role early,
// passes the request on and answers with FastAPI's response. FastAPI
// re-checks the session, the role, the input and that the ids belong
// together and audits every change.

// Who may try: any internal role. FastAPI decides by the jobs.manage
// permission the admin gives roles (role management; marketing by
// default, admin always): vertex_be/app/api/v1/jobs.py.
const JOB_MANAGER_ROLES = INTERNAL_ROLES;

// POST /api/jobs/:id/sectors — attaches one of the 8 canonical sectors to
// a programme (2026-09-02). id = the parent Job's id.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...JOB_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }); }

  return backendResponse(await callBackend(`/api/v1/jobs/${encodeURIComponent(id)}/sectors`, { method: "POST", body }));
}
