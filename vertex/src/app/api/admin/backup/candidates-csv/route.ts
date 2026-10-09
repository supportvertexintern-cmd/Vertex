import { NextRequest, NextResponse } from "next/server";
import { auditAccess } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function yesNo(value: boolean | null | undefined): string {
  return value === null || value === undefined ? "" : value ? "Yes" : "No";
}

function dateOnly(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

// GET /api/admin/backup/candidates-csv?start=&end= — full, unscoped CSV
// backup of every candidate (CRM Comments item 12, superseded 2026-08-12:
// plain CSV with a selectable date range instead of Google Sheets;
// widened same day — the first pass only covered the Candidate table's
// own columns, when "everything to do with the candidate" also means
// their most recent Application (programme, travel/visa readiness) and
// Case/document status, not just biodata). Admin/Operations/Director —
// matching CASE_MANAGER_ROLES-adjacent access, since this is
// operational/backup data, not staff-management. start/end filter on
// Candidate.created_at, inclusive; omit either (or both) for no bound.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["admin", "operations_team", "operations_director", "director", "hr"]);
  if (guardRes) return guardRes;

  const startParam = req.nextUrl.searchParams.get("start");
  const endParam = req.nextUrl.searchParams.get("end");
  const start = startParam ? new Date(startParam) : undefined;
  const end = endParam ? new Date(new Date(endParam).getTime() + 86400000 - 1) : undefined;

  const candidates = await prisma.candidate.findMany({
    where: start || end ? { created_at: { gte: start, lte: end } } : undefined,
    select: {
      id: true,
      full_name: true,
      phone: true,
      email: true,
      nationality: true,
      second_nationality: true,
      date_of_birth: true,
      passport_number: true,
      passport_expiry: true,
      current_occupation: true,
      highest_education: true,
      home_address: true,
      whatsapp_number: true,
      marital_status: true,
      desired_role: true,
      source: true,
      lifecycle_status: true,
      consent_given: true,
      consent_at: true,
      screening_result: true,
      screening_evaluated_at: true,
      return_reason: true,
      created_at: true,
      user: { select: { full_name: true, email: true, phone: true } },
      recruiter: { select: { full_name: true } },
      partner: { select: { name: true } },
      country: { select: { name: true, region: { select: { name: true } } } },
      documents: { select: { verification_status: true } },
      applications: {
        orderBy: { submitted_at: "desc" },
        take: 1,
        select: {
          submitted_at: true,
          job: { select: { title: true, country: true, city: true } },
          preferred_country_1: { select: { name: true } },
          preferred_country_2: { select: { name: true } },
          preferred_country_3: { select: { name: true } },
          preferred_sector: { select: { name: true } },
          earliest_travel_date: true,
          prior_eu_visa_applied: true,
          prior_eu_visa_applied_details: true,
          current_location_country_name: true,
          current_location_country: { select: { name: true } },
          holds_schengen_visa: true,
          holds_schengen_visa_details: true,
          prior_visa_refusals: true,
          prior_visa_refusals_details: true,
          available_for_embassy_appointment: true,
          willing_to_start_within_30_days: true,
          preferred_contact_channel: true,
          documents_available: true,
          payment_plan_acknowledged: true,
          case: { select: { current_stage: true, ops_review_status: true, created_at: true } },
        },
      },
    },
    orderBy: { created_at: "desc" },
  });

  const header = [
    "ID", "Name", "Email", "Phone", "Source", "Status",
    "Nationality", "Second Nationality", "Date of Birth",
    "Passport Number", "Passport Expiry",
    "Current Occupation", "Highest Education", "Home Address",
    "WhatsApp Number", "Marital Status", "Desired Role",
    "Region", "Country", "Recruiter", "Partner",
    "Consent Given", "Consent Date", "Screening Result", "Screening Evaluated", "Return Reason",
    "Programme", "Destination", "Earliest Travel Date",
    "Prior EU Visa Applied", "Prior EU Visa Applied Details",
    "Current Location", "Holds Schengen Visa", "Holds Schengen Visa Details",
    "Prior Visa Refusals", "Prior Visa Refusals Details",
    "Available for Embassy Appointment", "Willing to Start Within 30 Days",
    "Preferred Contact Channel", "Documents Self-Reported Available", "Payment Plan Acknowledged",
    "Application Submitted",
    "Case Stage", "Case Documentation Review Status", "Case Created",
    "Documents Uploaded", "Documents Verified", "Documents Rejected",
    "Candidate Record Created",
  ];

  const rows = candidates.map((c: (typeof candidates)[number]) => {
    const app = c.applications[0];
    const verifiedCount = c.documents.filter((d: (typeof c.documents)[number]) => d.verification_status === "verified").length;
    const rejectedCount = c.documents.filter((d: (typeof c.documents)[number]) => d.verification_status === "rejected").length;
    return [
      c.id,
      c.user?.full_name ?? c.full_name ?? "",
      c.user?.email ?? c.email ?? "",
      c.user?.phone ?? c.phone ?? "",
      c.source,
      c.lifecycle_status,
      c.nationality ?? "",
      c.second_nationality ?? "",
      dateOnly(c.date_of_birth),
      c.passport_number ?? "",
      dateOnly(c.passport_expiry),
      c.current_occupation ?? "",
      c.highest_education ?? "",
      c.home_address ?? "",
      c.whatsapp_number ?? "",
      c.marital_status ?? "",
      c.desired_role ?? "",
      c.country?.region.name ?? "",
      c.country?.name ?? "",
      c.recruiter?.full_name ?? "",
      c.partner?.name ?? "",
      yesNo(c.consent_given),
      dateOnly(c.consent_at),
      c.screening_result === null ? "Not yet evaluated" : c.screening_result ? "Passed" : "Failed",
      dateOnly(c.screening_evaluated_at),
      c.return_reason ?? "",
      app?.job ? app.job.title : app?.preferred_sector?.name ?? "",
      app?.job
        ? `${app.job.city}, ${app.job.country}`
        : [app?.preferred_country_1?.name, app?.preferred_country_2?.name, app?.preferred_country_3?.name].filter(Boolean).join(" / "),
      dateOnly(app?.earliest_travel_date),
      yesNo(app?.prior_eu_visa_applied),
      app?.prior_eu_visa_applied_details ?? "",
      app?.current_location_country?.name ?? app?.current_location_country_name ?? "",
      yesNo(app?.holds_schengen_visa),
      app?.holds_schengen_visa_details ?? "",
      yesNo(app?.prior_visa_refusals),
      app?.prior_visa_refusals_details ?? "",
      yesNo(app?.available_for_embassy_appointment),
      yesNo(app?.willing_to_start_within_30_days),
      app?.preferred_contact_channel ?? "",
      (app?.documents_available ?? []).join("; "),
      yesNo(app?.payment_plan_acknowledged),
      dateOnly(app?.submitted_at),
      app?.case?.current_stage ?? "",
      app?.case?.ops_review_status ?? "",
      dateOnly(app?.case?.created_at),
      c.documents.length,
      verifiedCount,
      rejectedCount,
      dateOnly(c.created_at),
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const suffix = startParam || endParam ? `_${startParam ?? "start"}_to_${endParam ?? "end"}` : "";

  await auditAccess(user!.userId, "CandidateExport", "export", {
    rows: candidates.length,
    filters: Object.fromEntries(req.nextUrl.searchParams),
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="candidates${suffix}.csv"`,
    },
  });
}
