import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// General staff/partner test accounts (password TestPassword123! for all) —
// the roster documented in CLAUDE.md, used throughout manual/live testing
// this session. Distinct from e2e/global-setup.ts's e2e-*@test.local
// accounts (torn down after every Playwright run) — these are meant to
// persist. Run against any database via DATABASE_URL, e.g.:
//   DATABASE_URL="<staging url>" npx tsx scripts/seed-test-accounts.ts
const prisma = new PrismaClient();

const PASSWORD = "TestPassword123!";

async function main() {
  const password_hash = await bcrypt.hash(PASSWORD, 12);

  const kenya = await prisma.country.findFirst({ where: { name: "Kenya" } });
  if (!kenya) throw new Error("Kenya not found — run `npm run db:seed` against this database first.");

  const supervisor = await prisma.user.upsert({
    where: { email: "supervisor@test.local" },
    update: { role: "country_supervisor", password_hash, email_verified: true, assigned_country_id: kenya.id },
    create: {
      full_name: "Test Supervisor",
      email: "supervisor@test.local",
      password_hash,
      role: "country_supervisor",
      email_verified: true,
      assigned_country_id: kenya.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "recruiter@test.local" },
    update: {
      role: "regional_recruiter",
      password_hash,
      email_verified: true,
      assigned_country_id: kenya.id,
      supervisor_id: supervisor.id,
    },
    create: {
      full_name: "Test Recruiter",
      email: "recruiter@test.local",
      password_hash,
      role: "regional_recruiter",
      email_verified: true,
      assigned_country_id: kenya.id,
      supervisor_id: supervisor.id,
    },
  });

  const inhouse = await prisma.user.upsert({
    where: { email: "inhouse@test.local" },
    update: { role: "inhouse_supervisor", password_hash, email_verified: true },
    create: { full_name: "Test In-House Supervisor", email: "inhouse@test.local", password_hash, role: "inhouse_supervisor", email_verified: true },
  });
  await prisma.inhouseCountryAssignment.upsert({
    where: { inhouse_supervisor_id_country_id: { inhouse_supervisor_id: inhouse.id, country_id: kenya.id } },
    update: {},
    create: { inhouse_supervisor_id: inhouse.id, country_id: kenya.id },
  });

  const STAFF_ROLES: { email: string; full_name: string; role: string }[] = [
    { email: "admin@test.local", full_name: "Test Admin", role: "admin" },
    { email: "director@test.local", full_name: "Test Director", role: "director" },
    { email: "marketing@test.local", full_name: "Test Marketing", role: "marketing" },
    { email: "hr@test.local", full_name: "Test HR", role: "hr" },
    { email: "operations@test.local", full_name: "Test Operations", role: "operations_team" },
    { email: "finance@test.local", full_name: "Test Finance", role: "finance" },
  ];
  for (const s of STAFF_ROLES) {
    await prisma.user.upsert({
      where: { email: s.email },
      update: { role: s.role as never, password_hash, email_verified: true },
      create: { full_name: s.full_name, email: s.email, password_hash, role: s.role as never, email_verified: true },
    });
    console.log(`✓ ${s.email} (${s.role})`);
  }
  console.log(`✓ recruiter@test.local (regional_recruiter, Kenya, supervised by supervisor@test.local)`);
  console.log(`✓ supervisor@test.local (country_supervisor, Kenya)`);
  console.log(`✓ inhouse@test.local (inhouse_supervisor, Kenya)`);

  // Partner login — a real Partner record + a linked User with role
  // "partner", matching how the admin-provisioned flow ends up (an active,
  // MOU-signed agency with a working login), not just a bare User row.
  const partnerUser = await prisma.user.upsert({
    where: { email: "partner@test.local" },
    update: { role: "partner", password_hash, email_verified: true },
    create: { full_name: "Test Partner Agency", email: "partner@test.local", password_hash, role: "partner", email_verified: true },
  });
  const existingPartner = await prisma.partner.findFirst({ where: { user_id: partnerUser.id } });
  if (existingPartner) {
    await prisma.partner.update({
      where: { id: existingPartner.id },
      data: { status: "active", mou_status: "signed" },
    });
  } else {
    await prisma.partner.create({
      data: {
        name: "Test Partner Agency",
        partner_type: "manpower_supplier",
        country_of_operation: "Kenya",
        contact_name: "Test Partner Agency",
        contact_email: "partner@test.local",
        contact_phone: "N/A",
        status: "active",
        mou_status: "signed",
        user_id: partnerUser.id,
      },
    });
  }
  console.log(`✓ partner@test.local (partner, Test Partner Agency — active, MOU signed)`);

  console.log(`\nDone. Password for all accounts: ${PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
