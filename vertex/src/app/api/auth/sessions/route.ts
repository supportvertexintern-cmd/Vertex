import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { clearSessionCookies } from "@/lib/session";

// The caller's sessions, kept by FastAPI since users step 8.2
// (vertex_be/app/api/v1/sessions.py), which checks the session itself.

// GET /api/auth/sessions: the caller's live sessions (browsers and devices
// signed in), for the "Active sessions" panel.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;
  return backendResponse(await callBackend("/api/v1/auth/sessions"));
}

// DELETE /api/auth/sessions: log out everywhere, this browser included.
export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  const authError = requireAuth(user);
  if (authError) return authError;
  const result = await callBackend("/api/v1/auth/sessions", { method: "DELETE", forward: await clientHeaders(req) });
  const res = backendResponse(result);
  if (result.ok) clearSessionCookies(res);
  return res;
}
