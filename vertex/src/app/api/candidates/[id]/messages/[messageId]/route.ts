import { NextRequest } from "next/server";
import { getAuthUser, requireAuth } from "@/lib/api-auth";
import { passOn, readJson, seg } from "@/lib/pipeline";

// PATCH/DELETE /api/candidates/:id/messages/:messageId — a sender correcting
// or removing their own message. Sender-only; written by FastAPI since the
// pipeline switch (step 6.7; vertex_be/app/api/v1/candidates.py).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  const { id, messageId } = await params;
  const read = await readJson(req);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/candidates/${seg(id)}/messages/${seg(messageId)}`, { method: "PATCH", body: read.body });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  const { id, messageId } = await params;
  return passOn(`/api/v1/candidates/${seg(id)}/messages/${seg(messageId)}`, { method: "DELETE" });
}
