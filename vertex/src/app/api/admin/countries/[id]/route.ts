import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns regions and countries since backend plan step 2.1
// (vertex_be/app/api/v1/geography.py): these handlers check the role early,
// pass the request on with callBackend() and answer with FastAPI's response.
// FastAPI re-checks the session, the role and the input itself, and
// vertex_web may no longer write either table (deploy/db-roles.sql).

// PATCH /api/admin/countries/:id: rename a country and/or move it to
// another region. Admin only.
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

  return backendResponse(await callBackend(`/api/v1/countries/${encodeURIComponent(id)}`, { method: "PATCH", body }));
}

// DELETE /api/admin/countries/:id: references to the country are cleared
// (SET NULL) or removed (CASCADE); one that still requires it is a 409
// in_use from FastAPI. Admin only.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/countries/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
