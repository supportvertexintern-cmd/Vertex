import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { readJson } from "@/lib/pipeline";

// POST /api/admin/monitoring/reset-emails/resend {user_id, kind, reason}: an
// admin sends a reset or setup email by hand. No limit counts it; FastAPI
// requires the reason and records it.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return backendResponse(
    await callBackend("/api/v1/monitoring/reset-emails/resend", { method: "POST", body: read.body, forward: await clientHeaders(req) }),
  );
}
