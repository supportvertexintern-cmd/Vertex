import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { computeAgentSignups, computeConversionRates } from "@/server/services/kpi";
import { getInhouseAssignedCountryIds } from "@/server/scope";

// GET /api/inhouse/supervisors — every Country Supervisor across the
// caller's assigned countries (2026-07: can be more than one), mirroring
// /api/supervisor/recruiters one tier up.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["inhouse_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const countryIds = await getInhouseAssignedCountryIds(user!.userId);
  if (!countryIds.length) return NextResponse.json({ data: [] });

  const periodStartParam = req.nextUrl.searchParams.get("period_start");
  const periodEndParam = req.nextUrl.searchParams.get("period_end");
  const periodStart = periodStartParam ? new Date(periodStartParam) : new Date(0);
  const periodEnd = periodEndParam ? new Date(periodEndParam) : new Date();

  const supervisors = await prisma.user.findMany({
    where: { role: "country_supervisor", assigned_country_id: { in: countryIds } },
    select: {
      id: true,
      full_name: true,
      email: true,
      assigned_country: { select: { id: true, name: true } },
      submitted_reports: { orderBy: { period_end: "desc" }, take: 1, select: { period_end: true } },
    },
    orderBy: { full_name: "asc" },
  });

  const data = await Promise.all(
    supervisors.map(async (s: (typeof supervisors)[number]) => {
      const filters = { countryId: s.assigned_country?.id, periodStart, periodEnd };
      const [candidatesTotal, conversion] = await Promise.all([computeAgentSignups(filters), computeConversionRates(filters)]);
      return {
        id: s.id,
        full_name: s.full_name,
        email: s.email,
        country: s.assigned_country,
        candidatesTotal,
        conversionRate: conversion.overall,
        lastReportAt: s.submitted_reports[0]?.period_end ?? null,
      };
    })
  );

  return NextResponse.json({ data });
}
