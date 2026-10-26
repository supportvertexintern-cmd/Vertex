import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns regions and countries since backend plan step 2.1
// (vertex_be/app/api/v1/geography.py): these handlers check the role early,
// pass the request on with callBackend() and answer with FastAPI's response.
// FastAPI re-checks the session, the role and the input itself, and
// vertex_web may no longer write either table (deploy/db-roles.sql).

// PATCH /api/admin/regions/:id: rename a region. Admin only.
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

  return backendResponse(await callBackend(`/api/v1/regions/${encodeURIComponent(id)}`, { method: "PATCH", body }));
}
