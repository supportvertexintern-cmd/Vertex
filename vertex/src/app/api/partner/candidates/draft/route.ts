import { NextRequest } from "next/server";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { passOn, readJson } from "@/lib/pipeline";

// POST /api/partner/candidates/draft — save an in-progress Agency
// Application Form, any fields, no checks until it's submitted. Written by
// FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/partner_submissions.py, save_draft).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["partner", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/partner/candidates/draft", { method: "POST", body: read.body });
}
