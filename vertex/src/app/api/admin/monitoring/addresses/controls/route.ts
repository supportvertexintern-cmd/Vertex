import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { queryOf, readJson } from "@/lib/pipeline";

// Admin → Monitoring → Address Controls (login protection PR 5): blocks and
// allows on network addresses and ranges. FastAPI checks every guard (a
// reason; a block's 1 to 30 days; never your own address, which it reads
// from the browser's address forwarded here; the widest ranges).

// GET /api/admin/monitoring/addresses/controls?include_ended=
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/addresses/controls", { query: queryOf(req, ["include_ended"]) }));
}

// POST /api/admin/monitoring/addresses/controls {network, kind, reason, days}
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return backendResponse(
    await callBackend("/api/v1/monitoring/addresses/controls", { method: "POST", body: read.body, forward: await clientHeaders(req) }),
  );
}
