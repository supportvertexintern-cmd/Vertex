import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { computeRecruiterTargetsVsActuals } from "@/server/services/kpi";

// GET /api/recruiter-targets/progress?period_start=...&period_end=...
// The calling recruiter's own target-vs-actual for a specific report
// period — actual is measured over the given window, not the parent
// campaign's full duration, so this reflects "progress so far this
// week/month" rather than a lifetime total.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter"]);
  if (guardRes) return guardRes;

  const periodStart = req.nextUrl.searchParams.get("period_start");
  const periodEnd = req.nextUrl.searchParams.get("period_end");
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: { code: "validation_error", message: "period_start and period_end are required." } }, { status: 422 });
  }

  const data = await computeRecruiterTargetsVsActuals(user!.userId, {
    periodStart: new Date(periodStart),
    periodEnd: new Date(periodEnd),
  });

  return NextResponse.json({ data });
}
