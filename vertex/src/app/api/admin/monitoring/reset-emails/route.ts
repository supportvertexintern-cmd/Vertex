import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { queryOf } from "@/lib/pipeline";
import { RESET_EMAIL_FILTERS } from "@/lib/monitoring";

// Admin → Monitoring → Reset Email Activity (login protection, 4.4): every
// reset, setup and verification email sent or refused, filtered and paged
// by FastAPI, which records the reading before it answers.

// GET /api/admin/monitoring/reset-emails?q=&kind=&result=&date_from=&date_to=&page=&pageSize=
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(
    await callBackend("/api/v1/monitoring/reset-emails", { query: queryOf(req, [...RESET_EMAIL_FILTERS, "page", "pageSize"]), forward: await clientHeaders(req) }),
  );
}
