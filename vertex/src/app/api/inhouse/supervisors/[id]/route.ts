import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { computeAgentSignups, computeConversionRates } from "@/server/services/kpi";
import { getInhouseAssignedCountryIds } from "@/server/scope";

// GET /api/inhouse/supervisors/:id — one Country Supervisor's summary,
// scoped to the caller's assigned countries.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const supervisor = await prisma.user.findUnique({
    where: { id },
    select: { id: true, full_name: true, email: true, role: true, assigned_country: { select: { id: true, name: true } } },
  });
  if (!supervisor || supervisor.role !== "country_supervisor") {
    return NextResponse.json({ error: { code: "not_found", message: "Country Supervisor not found." } }, { status: 404 });
  }

  if (user!.role !== "admin") {
    const countryIds = await getInhouseAssignedCountryIds(user!.userId);
    if (!supervisor.assigned_country || !countryIds.includes(supervisor.assigned_country.id)) {
      return forbidden({ error: { code: "forbidden", message: "Forbidden." } });
    }
  }

  const filters = { countryId: supervisor.assigned_country?.id, periodStart: new Date(0), periodEnd: new Date() };
  const [candidatesTotal, conversion] = await Promise.all([computeAgentSignups(filters), computeConversionRates(filters)]);

  return NextResponse.json({
    data: {
      supervisor: { id: supervisor.id, full_name: supervisor.full_name, email: supervisor.email },
      country: supervisor.assigned_country,
      candidatesTotal,
      conversionRate: conversion.overall,
    },
  });
}
