import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";
import { canAccessCase } from "@/server/scope";

const CASE_ACCESS_ROLES = ["candidate", "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "admin", "partner", "hr", "operations_team", "operations_director", "finance"] as const;

// GET /api/cases/:id — full case detail: stage history, contract, payments, retention follow-up.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...CASE_ACCESS_ROLES]);
  if (guardRes) return guardRes;

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    include: {
      application: {
        include: {
          candidate: {
            include: {
              user: { select: { full_name: true, email: true } },
              country: true,
              recruiter: { select: { id: true, full_name: true } },
              partner: { select: { name: true } },
              documents: { orderBy: { uploaded_at: "desc" } },
            },
          },
          job: { include: { payment_stages: { orderBy: { order: "asc" } } } },
          job_position: { select: { job_sector: { select: { sector: true } } } },
          preferred_country_1: { select: { name: true } },
          preferred_sector: { select: { name: true } },
        },
      },
      stage_events: { include: { owner: { select: { full_name: true } } }, orderBy: { entered_at: "asc" } },
      contract: true,
      payments: { include: { recorder: { select: { full_name: true } } }, orderBy: { recorded_at: "desc" } },
      retention_follow_up: true,
      ops_reviewed_by: { select: { full_name: true } },
      rejected_by: { select: { full_name: true } },
    },
  });

  if (!caseRecord) return NextResponse.json({ error: "Case not found." }, { status: 404 });

  const allowed = await canAccessCase(user!, {
    user_id: caseRecord.application.candidate.user_id,
    recruiter_id: caseRecord.application.candidate.recruiter_id,
    country_id: caseRecord.application.candidate.country_id,
    partner_id: caseRecord.application.candidate.partner_id,
  });
  if (!allowed) return forbidden({ error: "Forbidden." });

  return NextResponse.json({ data: caseRecord });
}
