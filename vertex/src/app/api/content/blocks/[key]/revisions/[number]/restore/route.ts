import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { passToLanding, segment } from "@/server/contentEditorRoute";

type Params = { params: Promise<{ key: string; number: string }> };

// POST /api/content/blocks/:key/revisions/:number/restore: copies a revision into the draft; needs landing.edit.
export async function POST(_req: Request, { params }: Params) {
  const guardRes = requireRole(await getAuthUser(), INTERNAL_ROLES);
  if (guardRes) return guardRes;
  const { key, number } = await params;
  return passToLanding(`${segment(key)}/revisions${segment(number)}/restore`, { method: "POST" });
}
