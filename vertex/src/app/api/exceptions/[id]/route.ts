import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

const STAFF_ROLES: Role[] = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"];

// PATCH /api/exceptions/:id — escalate (one tier up) or decide; "escalated"
// also goes up a tier and stays open, any other decision closes it. Who may
// act at which tier and in which country is FastAPI's since the pipeline
// switch (step 6.7; vertex_be/app/api/v1/exceptions.py and
// app/services/exception_workflow.py).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;
  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/exceptions/${seg(id)}`, { method: "PATCH", body: read.body });
}
