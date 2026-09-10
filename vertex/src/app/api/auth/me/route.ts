import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";

// GET /api/auth/me — cheap, DB-free session check (JWT decode only) for
// client components like Navbar that just need to know "is someone
// logged in, and as what role" to switch their own CTA, not full profile
// data (candidates/staff each already have dedicated profile endpoints
// for that).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ data: null }, { status: 401 });
  }
  return NextResponse.json({ data: { userId: user.userId, email: user.email, role: user.role } });
}
