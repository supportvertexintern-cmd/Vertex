import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { computeAgentSignups, computeConversionRates, computeRecruiterTargetsVsActuals } from "@/server/services/kpi";

// GET /api/supervisor/recruiters/:id?period_start=...&period_end=... — a
// single recruiter's detail view: profile, performance for the given
// period, their target-vs-actual, and the country's active campaign
// targets + this recruiter's own allocations (so the page can offer
// target-setting without a second round trip to /api/supervisor/team-targets).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["country_supervisor", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;

  const recruiter = await prisma.user.findUnique({
    where: { id },
    select: { id: true, full_name: true, email: true, role: true, supervisor_id: true, assigned_country_id: true },
  });
  if (!recruiter || recruiter.role !== "regional_recruiter") {
    return NextResponse.json({ error: { code: "not_found", message: "Recruiter not found." } }, { status: 404 });
  }
  if (user!.role !== "admin" && recruiter.supervisor_id !== user!.userId) {
    return NextResponse.json({ error: { code: "forbidden", message: "This recruiter is not under your supervision." } }, { status: 403 });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodStartParam = req.nextUrl.searchParams.get("period_start");
  const periodEndParam = req.nextUrl.searchParams.get("period_end");
  const periodStart = periodStartParam ? new Date(periodStartParam) : monthStart;
  const periodEnd = periodEndParam ? new Date(periodEndParam) : now;

  const [candidatesTotal, conversion, targetProgress, campaignTargets, allocations] = await Promise.all([
    computeAgentSignups({ recruiterId: id, periodStart, periodEnd }),
    computeConversionRates({ recruiterId: id, periodStart, periodEnd }),
    computeRecruiterTargetsVsActuals(id, { periodStart, periodEnd }),
    recruiter.assigned_country_id
      ? prisma.campaignTarget.findMany({
          where: { country_id: recruiter.assigned_country_id, campaign: { status: "active" } },
          select: {
            id: true,
            metric: true,
            target_value: true,
            campaign: { select: { id: true, name: true, start_date: true, end_date: true } },
          },
          orderBy: { created_at: "desc" },
        })
      : Promise.resolve([]),
    prisma.recruiterTarget.findMany({
      where: { recruiter_id: id },
      select: { id: true, campaign_target_id: true, recruiter_id: true, target_value: true },
    }),
  ]);

  return NextResponse.json({
    data: {
      recruiter: { id: recruiter.id, full_name: recruiter.full_name, email: recruiter.email },
      candidatesTotal,
      conversionRate: conversion.overall,
      targetProgress,
      campaignTargets,
      allocations,
    },
  });
}
