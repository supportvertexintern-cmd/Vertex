import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { comparePassword } from "@/lib/auth";
import { signToken } from "@/lib/jwt";
import { loginSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`login:${ip}`, { max: 10 });
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again later." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  // Use same generic message for security (avoid user enumeration)
  if (!user || !user.password_hash) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    return NextResponse.json(
      { error: "Invalid email or password." },
      { status: 401 }
    );
  }

  if (!user.email_verified) {
    return NextResponse.json(
      { error: "Please verify your email before logging in." },
      { status: 403 }
    );
  }

  const token = signToken({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  const res = NextResponse.json({
    message: "Login successful",
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
  });

  res.cookies.set("auth_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  });

  return res;
}
