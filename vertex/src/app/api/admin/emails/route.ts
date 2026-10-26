import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns email templates since backend plan step 3.1
// (vertex_be/app/api/v1/content.py): these handlers check the role early,
// pass the request on with callBackend() and keep this route's response
// shapes (a plain array, the plain template), so AdminSettings is
// unchanged. FastAPI re-checks the session, the role and the input itself,
// and vertex_web may no longer write the table (deploy/db-roles.sql).
// lib/email.ts reads a template directly before sending.

// GET /api/admin/emails: every template override, by event. Admin only.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const result = await callBackend("/api/v1/email-templates");
  return result.ok ? NextResponse.json(result.body.data) : backendResponse(result);
}

// PUT /api/admin/emails: creates or replaces the override for an event.
// Admin only.
export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }
  const result = await callBackend("/api/v1/email-templates", { method: "PUT", body });
  return result.ok ? NextResponse.json(result.body.data) : backendResponse(result);
}
