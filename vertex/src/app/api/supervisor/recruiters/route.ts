import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { computeAgentSignups, computeConversionRates } from "@/server/services/kpi";

// GET /api/supervisor/recruiters?period_start=...&period_end=... — the
// Recruiters tab's list: every recruiter under the caller plus a compact
// performance summary. Period defaults to all-time (epoch..now) when
// omitted, since "who are my recruiters and how are they doing overall" is
// the natural landing view before drilling into a specific window.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const periodStartParam = req.nextUrl.searchParams.get("period_start");
  const periodEndParam = req.nextUrl.searchParams.get("period_end");
  const periodStart = periodStartParam ? new Date(periodStartParam) : new Date(0);
  const periodEnd = periodEndParam ? new Date(periodEndParam) : new Date();

  const recruiters = await prisma.user.findMany({
    where: { role: "regional_recruiter", supervisor_id: user!.userId },
    select: {
      id: true,
      full_name: true,
      email: true,
      submitted_reports: {
        orderBy: { period_end: "desc" },
        take: 1,
        select: { period_end: true },
      },
    },
    orderBy: { full_name: "asc" },
  });

  const data = await Promise.all(
    recruiters.map(async (r: (typeof recruiters)[number]) => {
      const filters = { recruiterId: r.id, periodStart, periodEnd };
      const [candidatesTotal, conversion] = await Promise.all([
        computeAgentSignups(filters),
        computeConversionRates(filters),
      ]);
      return {
        id: r.id,
        full_name: r.full_name,
        email: r.email,
        candidatesTotal,
        conversionRate: conversion.overall,
        lastReportAt: r.submitted_reports[0]?.period_end ?? null,
      };
    })
  );

  return NextResponse.json({ data });
}
