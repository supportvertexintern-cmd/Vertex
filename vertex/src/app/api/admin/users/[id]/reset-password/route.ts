import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { passOn, seg } from "@/lib/pipeline";

// POST /api/admin/users/:id/reset-password — admin-triggered password
// reset, same one-time temp-password pattern as account creation: returned
// once in the response body, never stored/logged in plaintext.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  // FastAPI sets it since users step 8.3 (vertex_be/app/api/v1/users.py).
  return passOn(`/api/v1/users/${seg(id)}/reset-password`, { method: "POST" }, {
    unwrap: true,
    reshape: (data, body) => ({ data, temporaryPassword: body.temporaryPassword }),
  });
}
