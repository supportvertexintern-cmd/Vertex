import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { REFERRAL_AGENT_MANAGER_ROLES } from "@/lib/rbac";

// GET /api/admin/referral-agents/:id/targets — target-vs-actual for every
// period this agent has a target set for. Read from FastAPI since reads
// handover R3 (vertex_be/app/api/v1/dashboards.py).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  return backendResponse(await callBackend(`/api/v1/referral-agents/${seg(id)}/targets`));
}

// POST /api/admin/referral-agents/:id/targets — Director/Admin sets a new
// referral target for a period. Saved by FastAPI since users and sessions
// step 8.1 (vertex_be/app/api/v1/referral_agents.py, create_target), which
// re-checks the role and audits the write; vertex_web may no longer write
// the table (deploy/db-roles.sql).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REFERRAL_AGENT_MANAGER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/referral-agents/${seg(id)}/targets`, { method: "POST", body: read.body });
}
