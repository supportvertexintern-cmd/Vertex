import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { callBackend } from "@/lib/backend";

// GET /api/auth/me: "is someone signed in, and as what role", for client
// components like Navbar that switch their own CTA (candidates and staff
// each have dedicated profile endpoints for more). Since reads handover R7d
// this app checks only a token's signature and expiry, so the answer is
// FastAPI's (vertex_be/app/api/v1/me.py), which checks the session is still
// live: a revoked, deleted or demoted user is nobody here too (G19).
export async function GET(req: NextRequest) {
  if (!(await getAuthUser(req))) return NextResponse.json({ data: null }, { status: 401 });

  const res = await callBackend<{ id: string; email: string; role: string }>("/api/v1/me");
  if (!res.ok) {
    return res.status === 401
      ? NextResponse.json({ data: null }, { status: 401 })
      : NextResponse.json({ error: res.error }, { status: res.status });
  }
  const { id, email, role } = res.body.data;
  return NextResponse.json({ data: { userId: id, email, role } });
}
