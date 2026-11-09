import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { readJson } from "@/lib/pipeline";

// Admin → Monitoring → Login Protection (login protection PR 6): the
// thresholds, their defaults and ranges, and their history. FastAPI refuses
// a value outside its range (never clamps it), requires a reason and records
// every change.

// GET /api/admin/monitoring/settings/login-protection
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/settings/login-protection"));
}

// PUT /api/admin/monitoring/settings/login-protection {...values, reason}
export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return backendResponse(
    await callBackend("/api/v1/monitoring/settings/login-protection", { method: "PUT", body: read.body, forward: await clientHeaders(req) }),
  );
}
