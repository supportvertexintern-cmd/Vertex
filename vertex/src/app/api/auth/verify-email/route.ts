import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { limitByIp } from "@/lib/rate-limit";
import { verifyEmailToken } from "@/lib/jwt";

export async function GET(req: NextRequest) {
  const limited = limitByIp(req, "verify-email", { windowMs: 15 * 60_000, max: 10 });
  if (limited) return limited;
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Verification token is required." }, { status: 400 });
  }

  let payload: ReturnType<typeof verifyEmailToken>;
  try {
    payload = verifyEmailToken(token, "email_verification");
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired verification token." },
      { status: 400 }
    );
  }

  if (payload.type !== "email_verification") {
    return NextResponse.json({ error: "Invalid token type." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  if (user.email_verified) {
    return NextResponse.json({ message: "Email is already verified." });
  }

  await prisma.user.update({
    where: { id: payload.userId },
    data: { email_verified: true },
  });

  return NextResponse.json({ message: "Email verified successfully! You can now log in." });
}
