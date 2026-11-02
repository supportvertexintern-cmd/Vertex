import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { seg } from "@/lib/pipeline";

const CASE_ACCESS_ROLES = [
  "candidate",
  "regional_recruiter",
  "country_supervisor",
  "inhouse_supervisor",
  "director",
  "admin",
  "partner",
  "hr",
  "operations_team",
  "operations_director",
  "finance",
] as const;

// GET /api/cases/:id/audit-log — the "clear log of actions" requirement
// (2026-07-31, per the Operational Workflow SOP): what the audit trail
// recorded on the case and its stage events, contract, payments and
// retention follow-up, and the reminders sent, oldest first. Same read
// access as the case detail route itself. Read from FastAPI since reads
// handover R5 (vertex_be/app/api/v1/case_reads.py), which reads the trail
// through vertex_case_trail (migration 0008), without its snapshots.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CASE_ACCESS_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/cases/${seg(id)}/audit-log`));
}
