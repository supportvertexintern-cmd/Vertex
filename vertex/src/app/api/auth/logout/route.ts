import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/api-auth";
import { recordSecurityEvent } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (user) {
    await recordSecurityEvent("logout", { actorId: user.userId, entityType: "Auth", entityId: `user:${user.userId}`, detail: {} });
  }
  const res = NextResponse.json({ message: "Logged out successfully." });
  res.cookies.set("auth_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
  return res;
}
