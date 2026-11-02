import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { callBackend, legacyErrorResponse } from "@/lib/backend";
import { seg } from "@/lib/pipeline";

const CASE_ACCESS_ROLES = ["candidate", "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "partner", "hr", "operations_team", "operations_director", "finance"] as const;

// GET /api/cases/:id — full case detail: stage history, contract, payments,
// retention follow-up; { data }, or { error }. Read from FastAPI since reads
// handover R5 (vertex_be/app/api/v1/case_reads.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CASE_ACCESS_ROLES]);
  if (guardRes) return guardRes;

  const result = await callBackend(`/api/v1/cases/${seg(id)}`);
  return result.ok ? NextResponse.json(result.body) : legacyErrorResponse(result);
}
