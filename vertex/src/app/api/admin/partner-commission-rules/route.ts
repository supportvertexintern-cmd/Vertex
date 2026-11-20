import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { passOn, readJson } from "@/lib/pipeline";

// The partner commission rules grid (Phase 6): the registration and monthly
// deployment amounts the engine pays from now on. Directors and admins.
// FastAPI answers (vertex_be/app/api/v1/partner_ledgers.py); the roles must
// match PAYERS there (tests check it).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["admin", "director"]);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/partner-commission-rules"));
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["admin", "director"]);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/partner-commission-rules", { method: "POST", body: read.body });
}
