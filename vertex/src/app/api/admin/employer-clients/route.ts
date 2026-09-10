import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { createEmployerClientSchema } from "@/lib/validations";

// In-House Supervisor no longer manages Employer Clients — confirmed with
// the business, kept Director/admin-only.
const EMPLOYER_CLIENT_MANAGER_ROLES = ["director", "admin"] as const;

// GET /api/admin/employer-clients — readable by Marketing too (needs the
// list to link a job posting to a client), not just management.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["marketing", "director", "admin"]);
  if (guardRes) return guardRes;

  const employerClients = await prisma.employerClient.findMany({
    include: { _count: { select: { jobs: true } } },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ data: employerClients });
}

// POST /api/admin/employer-clients — In-House Supervisor/Director (admin retains override).
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...EMPLOYER_CLIENT_MANAGER_ROLES]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = createEmployerClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const db = auditedPrisma(user!.userId);
  const employerClient = await db.employerClient.create({ data: parsed.data });
  return NextResponse.json({ data: employerClient }, { status: 201 });
}
