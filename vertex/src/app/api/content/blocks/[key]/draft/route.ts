import { getAuthUser, requireRole } from "@/lib/api-auth";
import { INTERNAL_ROLES } from "@/lib/rbac";
import { NextRequest } from "next/server";
import { jsonBody, passToLanding, segment } from "@/server/contentEditorRoute";

type Params = { params: Promise<{ key: string }> };

// PUT /api/content/blocks/:key/draft: saves the draft ({body, visible}); needs landing.edit.
export async function PUT(req: NextRequest, { params }: Params) {
  const guardRes = requireRole(await getAuthUser(), INTERNAL_ROLES);
  if (guardRes) return guardRes;
  const sent = await jsonBody(req);
  if ("error" in sent) return sent.error;
  return passToLanding(`${segment((await params).key)}/draft`, { method: "PUT", body: sent.body });
}
