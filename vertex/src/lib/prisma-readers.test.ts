// The website files still allowed to use the database through Prisma
// (docs/architecture/reads-handover.md, D6). Every step of the handover
// moves its files' reads to FastAPI and takes them off this list; R8 ends
// with an empty list and no Prisma client. A new file that imports Prisma
// fails here, and so does a listed file that no longer does, so the list
// is always exactly what is left.

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

const STILL_READING: Record<string, string[]> = {
  "R2 partners and referral agents": [
    "app/api/admin/partners/[id]/route.ts",
    "app/api/admin/partners/route.ts",
    "app/api/admin/referral-agents/[id]/route.ts",
    "app/api/admin/referral-agents/countries/[countryId]/summary/route.ts",
    "app/api/admin/referral-agents/countries/route.ts",
    "app/api/admin/referral-agents/route.ts",
    "app/api/admin/referral-commission-rules/route.ts",
    "app/api/admin/referral-commissions/route.ts",
    "app/api/referral-agent/candidates/route.ts",
    "app/api/referral-agent/commissions/route.ts",
    "app/api/referral-agent/me/route.ts",
  ],
  "R3 recruitment operations and KPIs": [
    "app/api/inhouse/campaigns/route.ts",
    "app/api/inhouse/overview/route.ts",
    "app/api/management/report-metrics/route.ts",
    "app/api/reports/[id]/route.ts",
    "app/api/reports/consolidation-preview/route.ts",
    "app/api/reports/route.ts",
    "app/api/staff-kpi-targets/route.ts",
    "app/api/supervisor/overview/route.ts",
    "app/api/supervisor/recruiters/[id]/route.ts",
    "app/api/supervisor/recruiters/route.ts",
    "app/api/supervisor/team-targets/route.ts",
    "server/services/kpi.ts",
    "server/services/reportConsolidation.ts",
    "server/services/reportWorkflow.ts",
  ],
  "R4 candidate pipeline, part 1": [
    "app/api/applications/[id]/route.ts",
    "app/api/applications/route.ts",
    "app/api/candidates/[id]/messages/route.ts",
    "app/api/candidates/[id]/route.ts",
    "app/api/candidates/profile/route.ts",
    "app/api/candidates/route.ts",
    "app/api/partner-candidates/[id]/route.ts",
    "app/api/partner-candidates/route.ts",
    "app/api/partner/candidates/[id]/route.ts",
    "app/api/partner/candidates/route.ts",
    "app/api/rejected-submissions/route.ts",
    "server/scope.ts",
    "server/services/candidateSignals.ts",
    "server/services/documentCompleteness.ts",
    "server/services/opportunityFilters.ts",
  ],
  "R5 candidate pipeline, part 2": [
    "app/api/cases/[id]/audit-log/route.ts",
    "app/api/cases/[id]/contract/route.ts",
    "app/api/cases/[id]/route.ts",
    "app/api/cases/route.ts",
    "app/api/documents/[id]/signed-url/route.ts",
    "app/api/exceptions/route.ts",
    "lib/document-access.ts",
  ],
  "R6 payments and users": [
    "app/api/admin/users/route.ts",
    "app/api/cases/[id]/payments/route.ts",
    "app/api/consultation-bookings/route.ts",
    "app/api/finance/payments-due/route.ts",
    "app/api/inhouse/supervisors/[id]/route.ts",
    "app/api/inhouse/supervisors/route.ts",
    "app/api/payments/me/route.ts",
  ],
  "R7 cross-cutting": [
    "app/api/admin/backup/candidates-csv/route.ts",
    "app/api/backup/export/route.ts",
    "app/api/backup/records/route.ts",
    "lib/audit.ts",
    "lib/email.ts",
    "lib/security-monitor.ts",
    "lib/session.ts",
    "server/backup/exporter.ts",
  ],
  // prisma/seed.ts's helpers: they move with the seeds.
  "R8 close": ["server/services/paymentReceiptTypes.ts", "server/services/stripeProvisioning.ts"],
};

const IMPORTS_PRISMA = /from\s+["'](?:@\/lib\/prisma|(?:\.\.?\/)+(?:lib\/)?prisma)["']/;
const IS_TEST = /\.test\.tsx?$|(^|\/)test-[\w-]+\.ts$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("Prisma readers (reads handover)", () => {
  const importing = sourceFiles(SRC)
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .filter((f) => f !== "lib/prisma.ts" && !IS_TEST.test(f))
    .filter((f) => IMPORTS_PRISMA.test(readFileSync(path.join(SRC, f), "utf8")))
    .sort();

  it("only the files still listed use Prisma, and every listed file still does", () => {
    expect(importing).toEqual(Object.values(STILL_READING).flat().sort());
  });
});
