// Demo data for the customer-facing Vercel site (docs/demo-site.md).
// Invented people and records only: every email is @example.com, every
// phone number is fictional. Run after the base seed (prisma/seed.ts):
//
//   DEMO_SEED=yes DEMO_ACCOUNTS_FILE=<path outside the repo> npx tsx prisma/demo-seed.ts
//
// Refuses to run unless DEMO_SEED=yes, and refuses on any database that
// holds a real user (an email not ending in @example.com): it must never
// touch a stack's database. One random password per demo account is
// written to DEMO_ACCOUNTS_FILE, never printed.
import { PrismaClient, Role, CaseStage, CandidateLifecycleStatus, ApplicationStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const DOMAIN = "@example.com";

const STAFF: { role: Role; name: string; key: string }[] = [
  { role: "admin", name: "Demo Admin", key: "admin" },
  { role: "director", name: "Demo Director", key: "director" },
  { role: "hr", name: "Demo HR", key: "hr" },
  { role: "operations_team", name: "Demo Operations", key: "operations" },
  { role: "operations_director", name: "Demo Operations Director", key: "operations.director" },
  { role: "finance", name: "Demo Finance", key: "finance" },
  { role: "regional_recruiter", name: "Demo Recruiter", key: "recruiter" },
  { role: "country_supervisor", name: "Demo Country Supervisor", key: "supervisor" },
  { role: "marketing", name: "Demo Marketing", key: "marketing" },
];

const CANDIDATES: {
  name: string; nationality: string; status: CandidateLifecycleStatus; app?: ApplicationStatus; stage?: CaseStage;
}[] = [
  { name: "Amina Demo", nationality: "Kenyan", status: "submitted", app: "submitted" },
  { name: "Daniel Sample", nationality: "Ugandan", status: "submitted", app: "under_review" },
  { name: "Grace Example", nationality: "Ghanaian", status: "approved", app: "approved", stage: "registration_document_submission" },
  { name: "Joseph Placeholder", nationality: "Nigerian", status: "approved", app: "approved", stage: "permit_application_submission" },
  { name: "Mary Fictional", nationality: "Kenyan", status: "approved", app: "approved", stage: "visa_interview_preparation" },
  { name: "Peter Testcase", nationality: "Ugandan", status: "screened" },
];

function password() {
  return randomBytes(12).toString("base64url");
}

async function main() {
  if (process.env.DEMO_SEED !== "yes") throw new Error("Set DEMO_SEED=yes to load demo data");
  const out = process.env.DEMO_ACCOUNTS_FILE;
  if (!out) throw new Error("Set DEMO_ACCOUNTS_FILE to a path outside the repository");

  const real = await prisma.user.count({ where: { NOT: { email: { endsWith: DOMAIN } } } });
  if (real > 0) throw new Error(`Refusing: this database holds ${real} non-demo user(s). Demo data goes only into the demo database.`);
  if (await prisma.user.findUnique({ where: { email: `demo.admin${DOMAIN}` } })) {
    console.log("Demo data already loaded; nothing to do.");
    return;
  }

  const jobs = await prisma.job.findMany({ take: 5, orderBy: { created_at: "asc" } });
  const country = await prisma.country.findFirst({ where: { name: "Kenya" } });
  if (!jobs.length || !country) throw new Error("Run the base seed (prisma/seed.ts) first");

  const accounts: string[] = [];
  const account = async (key: string, full_name: string, role: Role, extra: object = {}) => {
    const pw = password();
    const user = await prisma.user.create({
      data: { email: `demo.${key}${DOMAIN}`, full_name, role, email_verified: true, password_hash: await bcrypt.hash(pw, 10), ...extra },
    });
    accounts.push(`${role.padEnd(20)} ${user.email.padEnd(40)} ${pw}`);
    return user;
  };

  const staff: Record<string, { id: string }> = {};
  for (const s of STAFF) {
    staff[s.key] = await account(s.key, s.name, s.role,
      s.role === "regional_recruiter" || s.role === "country_supervisor" ? { assigned_country_id: country.id } : {});
  }

  // Partners: one with an account and two candidates in progress.
  const partnerUser = await account("partner", "Demo Partner Agency", "partner");
  const partner = await prisma.partner.create({
    data: {
      name: "Demo Partner Agency", partner_type: "manpower_supplier", country_of_operation: "Kenya",
      contact_name: "Demo Partner Contact", contact_email: `partner.contact${DOMAIN}`, contact_phone: "+254 700 000 000",
      status: "active", user_id: partnerUser.id,
    },
  });
  await prisma.partnerCandidate.create({ data: { partner_id: partner.id, status: "draft", full_name: "Samuel Draftcase", job_id: jobs[0].id } });
  await prisma.partnerCandidate.create({ data: { partner_id: partner.id, status: "submitted", full_name: "Ruth Submitted", job_id: jobs[1 % jobs.length].id } });

  // Candidates at different points of the journey.
  for (const [i, c] of CANDIDATES.entries()) {
    const key = `candidate${i + 1}`;
    const user = await account(key, c.name, "candidate");
    const candidate = await prisma.candidate.create({
      data: {
        user_id: user.id, full_name: c.name, email: user.email, phone: `+254 700 000 1${i}0`,
        nationality: c.nationality, country_id: country.id, country_name: country.name,
        lifecycle_status: c.status, recruiter_id: staff.recruiter.id,
        consent_given: true, consent_at: new Date(),
      },
    });
    if (!c.app) continue;
    const application = await prisma.application.create({
      data: { candidate_id: candidate.id, job_id: jobs[i % jobs.length].id, application_status: c.app },
    });
    if (!c.stage) continue;
    const kase = await prisma.case.create({ data: { application_id: application.id, current_stage: c.stage } });
    await prisma.caseStageEvent.create({ data: { case_id: kase.id, stage: c.stage, owner_id: staff.operations.id } });
    await prisma.casePayment.create({
      data: {
        case_id: kase.id, type: "documentation", amount: 250, recorded_by: staff.finance.id,
        status: c.stage === "registration_document_submission" ? "pending" : "collected",
      },
    });
  }

  writeFileSync(out, [
    "Vertex demo site accounts (invented data). Share each customer only the accounts they need.",
    `Generated ${new Date().toISOString()}`, "",
    ...accounts, "",
  ].join("\n"), { mode: 0o600 });
  console.log(`Demo data loaded: ${accounts.length} accounts (passwords in DEMO_ACCOUNTS_FILE).`);
}

main().finally(() => prisma.$disconnect()).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
