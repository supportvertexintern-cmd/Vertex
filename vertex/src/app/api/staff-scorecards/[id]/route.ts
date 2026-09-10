import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { finalizeStaffScorecardSchema } from "@/lib/validations";
import { categorizeScore, computeOverallScore } from "@/server/services/scorecardScoring";
import type { Role } from "@prisma/client";

const REVIEWER_ROLES: Role[] = ["country_supervisor", "inhouse_supervisor", "director", "admin"];

// PATCH /api/staff-scorecards/:id — finalize a draft scorecard: computes
// the weighted overall score from its rated areas, derives the
// performance category and required action, and locks it.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, REVIEWER_ROLES);
  if (guardRes) return guardRes;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = finalizeStaffScorecardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const scorecard = await prisma.staffScorecard.findUnique({
    where: { id },
    select: { reviewer_id: true, status: true, areas: { select: { weight: true, rating: true } } },
  });
  if (!scorecard) return NextResponse.json({ error: { code: "not_found", message: "Scorecard not found." } }, { status: 404 });
  if (user!.role !== "admin" && scorecard.reviewer_id !== user!.userId) {
    return NextResponse.json({ error: { code: "forbidden", message: "Forbidden." } }, { status: 403 });
  }
  if (scorecard.status !== "draft") {
    return NextResponse.json({ error: { code: "already_finalized", message: "This scorecard has already been finalized." } }, { status: 422 });
  }
  type ScorecardArea = (typeof scorecard.areas)[number];
  if (scorecard.areas.some((a: ScorecardArea) => a.rating == null)) {
    return NextResponse.json({ error: { code: "incomplete", message: "Every area must be rated before finalizing." } }, { status: 422 });
  }

  const overallScore = computeOverallScore(scorecard.areas);
  const { category, requiredAction } = categorizeScore(overallScore);

  const db = auditedPrisma(user!.userId);
  const updated = await db.staffScorecard.update({
    where: { id },
    data: {
      status: "finalized",
      overall_score: overallScore,
      performance_category: category,
      required_action: requiredAction,
      review_date: parsed.data.review_date ? new Date(parsed.data.review_date) : new Date(),
    },
    select: { id: true, status: true, overall_score: true, performance_category: true, required_action: true, review_date: true },
  });

  return NextResponse.json({ data: updated });
}
