import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// PUT /api/admin/roles/:role/permissions: sets exactly what a role holds
// (vertex_be/app/api/v1/roles.py). Admin only. FastAPI refuses admin itself
// and the external roles, and re-checks the session, the role and the input.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ role: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { role } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  return backendResponse(
    await callBackend(`/api/v1/admin/roles/${encodeURIComponent(role)}/permissions`, { method: "PUT", body }),
  );
}
