import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

// FastAPI owns system settings since backend plan step 2.3
// (vertex_be/app/api/v1/settings.py): these handlers check the role early,
// pass the request on with callBackend() and answer with FastAPI's response.
// FastAPI re-checks the session, the role and the input itself, and
// vertex_web may no longer write the table (deploy/db-roles.sql). Reads in
// /api/apply/options and /api/chat stay here.

// GET /api/admin/settings: every setting as a plain key-value map (what
// AdminSettings expects), so FastAPI's {data} is unwrapped. Admin only.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const result = await callBackend<Record<string, string>>("/api/v1/settings");
  return result.ok ? NextResponse.json(result.body.data) : backendResponse(result);
}

// PUT /api/admin/settings: sets ai_enabled, whatsapp_number and intake_mode
// (others are ignored); answers { success: true } as before. Admin only.
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
  const result = await callBackend("/api/v1/settings", { method: "PUT", body });
  return result.ok ? NextResponse.json({ success: true }) : backendResponse(result);
}
