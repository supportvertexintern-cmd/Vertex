import { NextRequest, NextResponse } from "next/server";
import { auditAccess, auditFilters } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// GET /api/admin/backup/partners-csv?start=&end= — companion to
// candidates-csv (CRM Comments item 12, superseded 2026-08-12 — CSV with
// a selectable date range instead of Google Sheets; widened +
// Operations/Director access added same day). start/end filter on
// Partner.created_at (date onboarded), inclusive.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["admin", "operations_team", "operations_director", "director", "hr"]);
  if (guardRes) return guardRes;

  const startParam = req.nextUrl.searchParams.get("start");
  const endParam = req.nextUrl.searchParams.get("end");
  const start = startParam ? new Date(startParam) : undefined;
  const end = endParam ? new Date(new Date(endParam).getTime() + 86400000 - 1) : undefined;

  const partners = await prisma.partner.findMany({
    where: start || end ? { created_at: { gte: start, lte: end } } : undefined,
    select: {
      name: true,
      partner_type: true,
      country_of_operation: true,
      business_registration_number: true,
      contact_name: true,
      contact_email: true,
      contact_phone: true,
      status: true,
      mou_status: true,
      mou_signed_at: true,
      notes: true,
      created_at: true,
      user: { select: { email: true } },
      _count: { select: { candidates: true, partner_candidates: true } },
    },
    orderBy: { created_at: "desc" },
  });

  const header = [
    "Name", "Type", "Country of Operation", "Registration Number",
    "Contact Name", "Contact Email", "Contact Phone", "Login Email",
    "Status", "MOU Status", "MOU Signed Date", "Notes",
    "Candidates Submitted", "Date Onboarded",
  ];
  const rows = partners.map((p: (typeof partners)[number]) => [
    p.name,
    p.partner_type,
    p.country_of_operation,
    p.business_registration_number ?? "",
    p.contact_name,
    p.contact_email,
    p.contact_phone,
    p.user?.email ?? "",
    p.status,
    p.mou_status,
    p.mou_signed_at ? p.mou_signed_at.toISOString().slice(0, 10) : "",
    p.notes ?? "",
    p._count.candidates + p._count.partner_candidates,
    p.created_at.toISOString().slice(0, 10),
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const suffix = startParam || endParam ? `_${startParam ?? "start"}_to_${endParam ?? "end"}` : "";

  await auditAccess(user!.userId, "PartnerExport", "export", {
    rows: partners.length,
    filters: auditFilters(req.nextUrl.searchParams),
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="partners${suffix}.csv"`,
    },
  });
}
