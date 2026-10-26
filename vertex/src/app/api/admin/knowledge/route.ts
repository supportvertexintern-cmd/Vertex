import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns knowledge articles since backend plan step 3.1
// (vertex_be/app/api/v1/content.py): these handlers check the role early,
// pass the request on with callBackend() and keep this route's response
// shapes (a plain array, the plain article, { success: true }), so
// AdminSettings is unchanged. FastAPI re-checks the session, the role and
// the input itself, and vertex_web may no longer write the table
// (deploy/db-roles.sql). The Help Center and /api/chat read it directly.

// GET /api/admin/knowledge: every article, by category. Admin only.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const result = await callBackend("/api/v1/knowledge");
  return result.ok ? NextResponse.json(result.body.data) : backendResponse(result);
}

// POST /api/admin/knowledge: adds an article. Admin only.
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
  const result = await callBackend("/api/v1/knowledge", { method: "POST", body });
  return result.ok ? NextResponse.json(result.body.data, { status: 201 }) : backendResponse(result);
}

// DELETE /api/admin/knowledge?id=…: removes an article. Admin only.
export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: { code: "validation_error", message: "Missing article ID" } }, { status: 400 });
  const result = await callBackend(`/api/v1/knowledge/${encodeURIComponent(id)}`, { method: "DELETE" });
  return result.ok ? NextResponse.json({ success: true }) : backendResponse(result);
}
