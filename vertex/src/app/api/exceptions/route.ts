import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { passOn, queryOf, readJson } from "@/lib/pipeline";
import type { Role } from "@/lib/enums";

const STAFF_ROLES: Role[] = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"];

// GET /api/exceptions — role-scoped, same shape as /api/reports: a
// recruiter sees their own; a country/in-house supervisor sees their own
// plus their country's; director/admin see everything. Searched (reference,
// issue, candidate), filtered by status, escalation level and category, and
// paged. Read from FastAPI since reads handover R5
// (vertex_be/app/api/v1/case_reads.py).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;

  const query = queryOf(req, ["status", "escalation_level", "category", "q", "page", "pageSize"]);
  return backendResponse(await callBackend("/api/v1/exceptions", { query }));
}

// POST /api/exceptions — raise an exception (Supervisory Reporting
// Framework §6), any staff role, at any time. Written by FastAPI since the
// pipeline switch (step 6.7; vertex_be/app/api/v1/exceptions.py): the
// starting tier by role, the sequential reference, the corrective actions.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/exceptions", { method: "POST", body: read.body });
}
