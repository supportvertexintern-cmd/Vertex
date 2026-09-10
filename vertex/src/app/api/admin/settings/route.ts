import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  if (user!.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const settings = await prisma.systemSetting.findMany();
  // Return as a key-value object
  const settingsObj = (settings as any[]).reduce((acc: any, s: any) => ({ ...acc, [s.key]: s.value }), {});
  return NextResponse.json(settingsObj);
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  if (user!.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json();
  const validKeys = ["ai_enabled", "whatsapp_number", "intake_mode"];

  if (body.intake_mode !== undefined && !["email", "crm"].includes(body.intake_mode)) {
    return NextResponse.json({ error: "intake_mode must be 'email' or 'crm'" }, { status: 400 });
  }

  try {
    const upserts = Object.entries(body)
      .filter(([key]) => validKeys.includes(key))
      .map(([key, value]) => {
        return prisma.systemSetting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) }
        });
      });

    await prisma.$transaction(upserts);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
