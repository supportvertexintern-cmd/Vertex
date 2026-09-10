import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { createRecruiterNoteSchema } from "@/lib/validations";

// GET /api/recruiter-notes?recruiter_id=... — a recruiter reads their own
// notes (recruiter_id defaults to, and must equal, their own id); a
// supervisor reads any one of their own recruiters' notes; admin reads
// anyone's. This is the "communicate with that particular recruiter"
// capability surfaced back to the recruiter (Overview tab) as well as to
// the supervisor (recruiter detail tab).
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const requestedRecruiterId = req.nextUrl.searchParams.get("recruiter_id");

  let recruiterId: string;
  if (user!.role === "regional_recruiter") {
    if (requestedRecruiterId && requestedRecruiterId !== user!.userId) {
      return NextResponse.json({ error: { code: "forbidden", message: "You can only read your own notes." } }, { status: 403 });
    }
    recruiterId = user!.userId;
  } else {
    if (!requestedRecruiterId) {
      return NextResponse.json({ error: { code: "validation_error", message: "recruiter_id is required." } }, { status: 422 });
    }
    if (user!.role === "country_supervisor") {
      const recruiter = await prisma.user.findUnique({ where: { id: requestedRecruiterId }, select: { supervisor_id: true } });
      if (recruiter?.supervisor_id !== user!.userId) {
        return NextResponse.json({ error: { code: "forbidden", message: "This recruiter is not under your supervision." } }, { status: 403 });
      }
    }
    recruiterId = requestedRecruiterId;
  }

  const notes = await prisma.recruiterNote.findMany({
    where: { recruiter_id: recruiterId },
    select: { id: true, message: true, created_at: true, author: { select: { full_name: true } } },
    orderBy: { created_at: "desc" },
  });

  return NextResponse.json({ data: notes });
}

// POST /api/recruiter-notes — a Country Supervisor leaves a note for one
// of their own recruiters.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = createRecruiterNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  if (user!.role === "country_supervisor") {
    const recruiter = await prisma.user.findUnique({ where: { id: parsed.data.recruiter_id }, select: { supervisor_id: true } });
    if (recruiter?.supervisor_id !== user!.userId) {
      return NextResponse.json({ error: { code: "forbidden", message: "This recruiter is not under your supervision." } }, { status: 403 });
    }
  }

  const note = await auditedPrisma(user!.userId).recruiterNote.create({
    data: { recruiter_id: parsed.data.recruiter_id, author_id: user!.userId, message: parsed.data.message },
    select: { id: true, message: true, created_at: true, author: { select: { full_name: true } } },
  });

  return NextResponse.json({ data: note }, { status: 201 });
}
