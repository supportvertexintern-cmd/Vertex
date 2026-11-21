import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { passToLanding, segment } from "@/server/contentEditorRoute";
import { resetLandingCache } from "@/server/services/landingContent";

type Params = { params: Promise<{ key: string }> };

// POST /api/content/blocks/:key/publish: makes the draft what visitors see; needs landing.publish.
// This server shows it at once; another instance of the site within its 30-second cache.
export async function POST(_req: Request, { params }: Params) {
  const guardRes = requireRole(await getAuthUser(), INTERNAL_ROLES);
  if (guardRes) return guardRes;
  const res = await passToLanding(`${segment((await params).key)}/publish`, { method: "POST" });
  if (res.ok) resetLandingCache();
  return res;
}
