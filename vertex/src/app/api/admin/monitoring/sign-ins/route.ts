import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { queryOf } from "@/lib/pipeline";
import { SIGN_IN_FILTERS } from "@/lib/monitoring";

// Admin → Monitoring → Sign-in Activity (login protection, 4.2): every
// sign-in attempt, filtered and paged by FastAPI, which records the reading
// (with the browser's address) before it answers.

// GET /api/admin/monitoring/sign-ins?q=&result=&failures_only=&user_id=&ip=&country=&date_from=&date_to=&page=&pageSize=
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(
    await callBackend("/api/v1/monitoring/sign-ins", { query: queryOf(req, [...SIGN_IN_FILTERS, "page", "pageSize"]), forward: await clientHeaders(req) }),
  );
}
