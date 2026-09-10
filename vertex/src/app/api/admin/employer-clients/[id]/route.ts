import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { updateEmployerClientSchema } from "@/lib/validations";

const EMPLOYER_CLIENT_MANAGER_ROLES = ["director", "admin"] as const;

// GET /api/admin/employer-clients/:id — detail, including its linked jobs.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["marketing", "director", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const employerClient = await prisma.employerClient.findUnique({
    where: { id },
    include: {
      jobs: { select: { id: true, title: true, country: true, city: true, status: true, created_at: true }, orderBy: { created_at: "desc" } },
    },
  });
  if (!employerClient) {
    return NextResponse.json({ error: { code: "not_found", message: "Employer/client not found." } }, { status: 404 });
  }

  return NextResponse.json({ data: employerClient });
}

// PATCH /api/admin/employer-clients/:id
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...EMPLOYER_CLIENT_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const existing = await prisma.employerClient.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "Employer/client not found." } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateEmployerClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const db = auditedPrisma(user!.userId);
  const employerClient = await db.employerClient.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ data: employerClient });
}
