import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { NextRequest } from "next/server";
import { passToLanding } from "@/server/contentEditorRoute";

// GET /api/content/blocks?group=web|mobile|shared: every block, with its published version and any draft.
export async function GET(req: NextRequest) {
  const guardRes = requireRole(await getAuthUser(), INTERNAL_ROLES);
  if (guardRes) return guardRes;
  const group = req.nextUrl.searchParams.get("group") ?? undefined;
  return passToLanding("", { query: { group } });
}
