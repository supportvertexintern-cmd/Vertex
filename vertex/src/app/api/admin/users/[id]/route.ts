import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { updateStaffUserSchema } from "@/lib/validations";
import { isStaffRole } from "@/lib/rbac";
import { callBackend } from "@/lib/backend";
import { accountsOnFastApi } from "@/lib/flags";
import { passOn, pipelineResponse, seg } from "@/lib/pipeline";
import { alertOnPrivilegeGranted } from "@/lib/auth-backend";

// PATCH /api/admin/users/:id — assign role, supervisor, and/or country
// (SRS FR-1.1, FR-1.3 "support reassignment", FR-1.4).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  // FastAPI writes since users step 8.3 (vertex_be/app/api/v1/users.py),
  // refusing a change to one's own role and the last admin's demotion. Below
  // is the way back, behind FLAG_ACCOUNTS_FASTAPI_ADMIN_USERS (lib/flags.ts),
  // until step 8.5.
  if (accountsOnFastApi("ADMIN_USERS")) {
    const result = await callBackend(`/api/v1/users/${seg(id)}`, { method: "PATCH", body });
    alertOnPrivilegeGranted(result, user!.userId);
    return pipelineResponse(result);
  }

  const parsed = updateStaffUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: { code: "not_found", message: "User not found." } }, { status: 404 });
  }

  const { supervisor_id, assigned_country_id, assigned_country_ids, role } = parsed.data;

  // Unity of command (FR-1.3): no self-supervision, and a supervisor must
  // themselves be a staff member, not a candidate.
  if (supervisor_id) {
    if (supervisor_id === id) {
      return NextResponse.json(
        { error: { code: "invalid_supervisor", message: "A user cannot supervise themselves." } },
        { status: 422 }
      );
    }
    const supervisor = await prisma.user.findUnique({ where: { id: supervisor_id } });
    if (!supervisor || !isStaffRole(supervisor.role)) {
      return NextResponse.json(
        { error: { code: "invalid_supervisor", message: "Supervisor must be an existing staff member." } },
        { status: 422 }
      );
    }
  }

  if (assigned_country_id) {
    const country = await prisma.country.findUnique({ where: { id: assigned_country_id } });
    if (!country) {
      return NextResponse.json({ error: { code: "not_found", message: "Country not found." } }, { status: 404 });
    }
  }

  if (assigned_country_ids?.length) {
    const count = await prisma.country.count({ where: { id: { in: assigned_country_ids } } });
    if (count !== assigned_country_ids.length) {
      return NextResponse.json({ error: { code: "not_found", message: "One or more countries not found." } }, { status: 404 });
    }
  }

  const updated = await auditedPrisma(user!.userId).user.update({
    where: { id },
    data: {
      ...(role !== undefined ? { role } : {}),
      ...(supervisor_id !== undefined ? { supervisor_id } : {}),
      ...(assigned_country_id !== undefined ? { assigned_country_id } : {}),
    },
    select: {
      id: true,
      full_name: true,
      email: true,
      role: true,
      supervisor_id: true,
      supervisor: { select: { id: true, full_name: true } },
      assigned_country_id: true,
      assigned_country: { select: { id: true, name: true } },
    },
  });

  // In-House Supervisor multi-country (2026-07): assigned_country_ids is a
  // full replace-all, not a merge — undefined means "leave assignments
  // untouched" (distinct from an empty array, which clears every one).
  if (assigned_country_ids !== undefined) {
    await prisma.$transaction([
      prisma.inhouseCountryAssignment.deleteMany({ where: { inhouse_supervisor_id: id } }),
      ...(assigned_country_ids.length
        ? [prisma.inhouseCountryAssignment.createMany({ data: assigned_country_ids.map((country_id) => ({ inhouse_supervisor_id: id, country_id })) })]
        : []),
    ]);
  }

  const assignments = await prisma.inhouseCountryAssignment.findMany({
    where: { inhouse_supervisor_id: id },
    select: { country: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ data: { ...updated, assigned_countries: assignments.map((a: (typeof assignments)[number]) => a.country) } });
}

// DELETE /api/admin/users/:id — removes a staff account. Self-delete is
// blocked: an admin locking themselves out (especially the only admin
// account) is a much worse failure mode than requiring another admin to
// do it.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  // FastAPI deletes since users step 8.3, keeping the last admin; below is
  // the way back, behind FLAG_ACCOUNTS_FASTAPI_ADMIN_USERS, until step 8.5.
  if (accountsOnFastApi("ADMIN_USERS")) return passOn(`/api/v1/users/${seg(id)}`, { method: "DELETE" });

  if (id === user!.userId) {
    return NextResponse.json(
      { error: { code: "self_delete", message: "You can't remove your own account." } },
      { status: 400 }
    );
  }

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) {
    return NextResponse.json({ error: { code: "not_found", message: "User not found." } }, { status: 404 });
  }

  await auditedPrisma(user!.userId).user.delete({ where: { id } });
  return NextResponse.json({ data: { id } });
}
