import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { passToLanding, segment } from "@/server/contentEditorRoute";

type Params = { params: Promise<{ key: string }> };

// GET /api/content/blocks/:key: one block, with its published version and any draft.
export async function GET(_req: Request, { params }: Params) {
  const guardRes = requireRole(await getAuthUser(), INTERNAL_ROLES);
  if (guardRes) return guardRes;
  return passToLanding(segment((await params).key));
}
