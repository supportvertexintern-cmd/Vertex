import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const articles = await prisma.knowledgeArticle.findMany({ orderBy: { category: "asc" } });
  return NextResponse.json(articles);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  if (user!.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json();
  if (!body.title || !body.content) return NextResponse.json({ error: "Missing required fields" }, { status: 400 });

  const article = await prisma.knowledgeArticle.create({
    data: {
      title: body.title,
      category: body.category || "General",
      content: body.content,
    }
  });
  return NextResponse.json(article, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  if (user!.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing article ID" }, { status: 400 });

  await prisma.knowledgeArticle.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
