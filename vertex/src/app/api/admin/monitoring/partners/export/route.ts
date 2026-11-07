import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { legacyErrorResponse, passFile } from "@/lib/backend";
import { queryOf } from "@/lib/pipeline";
import { PARTNER_FILTERS } from "@/lib/monitoring";

// GET /api/admin/monitoring/partners/export?<the list's filters>: the
// filtered list as CSV. FastAPI records the export on the audit trail before
// it leaves, and refuses it (503) if it can't.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const result = await passFile("/api/v1/monitoring/partners.csv", { query: queryOf(req, PARTNER_FILTERS), timeoutMs: 60_000 });
  return result instanceof NextResponse ? result : legacyErrorResponse(result);
}
