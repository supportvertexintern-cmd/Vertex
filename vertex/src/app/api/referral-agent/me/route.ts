import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// GET /api/referral-agent/me — the agent's own profile, referral link/QR,
// live per-milestone counts, and commission summary. Scoped by
// ReferralAgent.user_id, resolved from the authenticated session — never
// takes an id param, matching the "own data only" shape every other
// self-service portal (Partner, Candidate) already uses.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["referral_agent"]);
  if (guardRes) return guardRes;

  const agent = await prisma.referralAgent.findUnique({
    where: { user_id: user!.userId },
    include: { countryRef: { select: { id: true, name: true } } },
  });
  if (!agent) {
    return NextResponse.json({ error: { code: "not_found", message: "Referral agent record not found." } }, { status: 404 });
  }

  const [totalReferrals, commissions] = await Promise.all([
    prisma.candidate.count({ where: { referral_agent_id: agent.id } }),
    prisma.referralCommission.findMany({
      where: { referral_agent_id: agent.id },
      select: { milestone: true, amount: true, currency: true, status: true },
    }),
  ]);

  const commissionSummary = {
    earned: commissions.reduce((sum: number, c: (typeof commissions)[number]) => sum + c.amount, 0),
    pending: commissions.filter((c: (typeof commissions)[number]) => c.status === "pending" || c.status === "approved").reduce((sum: number, c: (typeof commissions)[number]) => sum + c.amount, 0),
    paid: commissions.filter((c: (typeof commissions)[number]) => c.status === "paid").reduce((sum: number, c: (typeof commissions)[number]) => sum + c.amount, 0),
    currency: commissions[0]?.currency ?? "USD",
  };

  // A "registered"-milestone ReferralCommission row is created for every
  // referred candidate (even a £0 one, which auto-settles as "paid") —
  // see FastAPI's commission_if_due — so every milestone count,
  // including registered, is derivable from this one ledger query.
  const milestoneCounts: Record<string, number> = {
    registered: 0,
    qualified: 0,
    application_submitted: 0,
    work_permit_approved: 0,
    visa_approved: 0,
    deployed: 0,
  };
  for (const c of commissions) {
    milestoneCounts[c.milestone] = (milestoneCounts[c.milestone] ?? 0) + 1;
  }

  const referralLink = `${APP_URL}/apply?ref=${agent.referral_code}`;
  const qrDataUri = await QRCode.toDataURL(referralLink);

  return NextResponse.json({
    data: {
      id: agent.id,
      full_name: agent.full_name,
      email: agent.email,
      status: agent.status,
      country: agent.countryRef?.name ?? agent.country,
      referral_code: agent.referral_code,
      referral_link: referralLink,
      qr_data_uri: qrDataUri,
      total_referrals: totalReferrals,
      milestone_counts: milestoneCounts,
      commission_summary: commissionSummary,
    },
  });
}
