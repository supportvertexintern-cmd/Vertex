import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const templates = await prisma.emailTemplate.findMany({ orderBy: { event: "asc" } });
  return NextResponse.json(templates);
}

export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  if (user!.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json();
  if (!body.event || !body.subject || !body.body_html) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const template = await prisma.emailTemplate.upsert({
    where: { event: body.event },
    update: { subject: body.subject, body_html: body.body_html },
    create: { event: body.event, subject: body.subject, body_html: body.body_html }
  });

  return NextResponse.json(template);
}
