import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { readJson, seg } from "@/lib/pipeline";

// POST /api/admin/monitoring/addresses/limited/:key/clear {reason}: lifts one
// per-address limit at once. FastAPI requires the reason and records it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  const { key } = await params;
  return backendResponse(
    await callBackend(`/api/v1/monitoring/addresses/limited/${seg(key)}/clear`, { method: "POST", body: read.body, forward: await clientHeaders(req) }),
  );
}
