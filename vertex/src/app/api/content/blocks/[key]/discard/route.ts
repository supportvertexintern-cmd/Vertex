import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { passToLanding, segment } from "@/server/contentEditorRoute";

type Params = { params: Promise<{ key: string }> };

// POST /api/content/blocks/:key/discard: drops the draft; needs landing.edit.
export async function POST(_req: Request, { params }: Params) {
  const guardRes = requireRole(await getAuthUser(), INTERNAL_ROLES);
  if (guardRes) return guardRes;
  return passToLanding(`${segment((await params).key)}/discard`, { method: "POST" });
}
