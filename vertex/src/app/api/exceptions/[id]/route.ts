import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { updateExceptionSchema } from "@/lib/validations";
import { nextEscalationLevel, roleCanActOnLevel } from "@/server/services/exceptionWorkflow";
import { getInhouseAssignedCountryIds } from "@/server/scope";
import type { EscalationLevel, Role } from "@prisma/client";

const STAFF_ROLES: Role[] = ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin"];

async function canActOn(user: { userId: string; role: Role }, exception: { raised_by: string; country_id: string | null; escalation_level: EscalationLevel }) {
  if (user.role === "admin") return true;
  if (exception.raised_by === user.userId) return true;
  if (user.role === "regional_recruiter") return false;
  if (!roleCanActOnLevel(user.role, exception.escalation_level)) return false;
  if (user.role === "director") return true;

  if (!exception.country_id) return false;
  if (user.role === "inhouse_supervisor") {
    const countryIds = await getInhouseAssignedCountryIds(user.userId);
    return countryIds.includes(exception.country_id);
  }
  const staff = await prisma.user.findUnique({ where: { id: user.userId }, select: { assigned_country_id: true } });
  return staff?.assigned_country_id === exception.country_id;
}

// PATCH /api/exceptions/:id — escalate (push up one tier) or decide
// (Approved/Modified/Rejected/Escalated, per §6's own "Supervisor
// Decision" box). A decision of "escalated" advances the tier and keeps
// the exception open; any other decision closes it out.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, STAFF_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateExceptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const exception = await prisma.exception.findUnique({
    where: { id },
    select: { raised_by: true, country_id: true, escalation_level: true, status: true },
  });
  if (!exception) return NextResponse.json({ error: { code: "not_found", message: "Exception not found." } }, { status: 404 });
  if (exception.status === "closed") {
    return NextResponse.json({ error: { code: "already_closed", message: "This exception is already closed." } }, { status: 422 });
  }
  if (!(await canActOn(user!, exception))) {
    return forbidden({ error: { code: "forbidden", message: "Forbidden." } });
  }

  const db = auditedPrisma(user!.userId);

  if (parsed.data.action === "escalate") {
    const updated = await db.exception.update({
      where: { id },
      data: { escalation_level: nextEscalationLevel(exception.escalation_level) },
      select: { id: true, escalation_level: true, status: true },
    });
    return NextResponse.json({ data: updated });
  }

  const { decision, decision_notes } = parsed.data;
  const updated = await db.exception.update({
    where: { id },
    data: {
      decision,
      decision_notes,
      decided_by: user!.userId,
      decided_at: new Date(),
      escalation_level: decision === "escalated" ? nextEscalationLevel(exception.escalation_level) : exception.escalation_level,
      status: decision === "escalated" ? "open" : "closed",
    },
    select: { id: true, escalation_level: true, status: true, decision: true },
  });
  return NextResponse.json({ data: updated });
}
