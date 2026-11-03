import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";
import { passOn, pipelineResponse, seg } from "@/lib/pipeline";

// PATCH /api/admin/users/:id — assign role, supervisor, and/or country
// (SRS FR-1.1, FR-1.3 "support reassignment", FR-1.4).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  // FastAPI writes since users step 8.3 (vertex_be/app/api/v1/users.py),
  // refusing a change to one's own role and the last admin's demotion.
  const result = await callBackend(`/api/v1/users/${seg(id)}`, { method: "PATCH", body });
  return pipelineResponse(result);
}

// DELETE /api/admin/users/:id — removes a staff account. Self-delete is
// blocked: an admin locking themselves out (especially the only admin
// account) is a much worse failure mode than requiring another admin to
// do it.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  // FastAPI deletes since users step 8.3, keeping the last admin.
  return passOn(`/api/v1/users/${seg(id)}`, { method: "DELETE" });
}
