import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { OPERATIONS_ROLES } from "@/lib/rbac";

// POST /api/cases/:id/remind — Operations chasing a delayed document or
// payment. Recorded by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/cases.py, remind); this app sends the email after.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, OPERATIONS_ROLES);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/cases/${seg(id)}/remind`, { method: "POST", body: read.body }, { legacyErrors: true });
}
