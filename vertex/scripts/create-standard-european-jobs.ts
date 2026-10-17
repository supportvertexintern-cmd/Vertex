import { prisma } from "../src/lib/prisma";
import { ensurePaymentReceiptDocumentTypes } from "../src/server/services/paymentReceiptTypes";
import { syncJobMilestonePricing } from "../src/server/services/stripeProvisioning";
import type { CaseStage } from "@prisma/client";

// One-off job creation (2026-09-16) for the "Standard European Work
// Permit Program 2026" PDF — 8 countries, each with a Non-Credit and a
// Credit Service variant (16 Jobs total), using the new flexible
// JobPaymentStage model. Non-Credit is public (partner_only: false);
// Credit is partner_only: true, matching every existing is_credit_service
// Job's visibility (confirmed with the business, 2026-09-16) — the PDF
// itself doesn't state a partner restriction, but this keeps the new
// Credit jobs consistent with the established pattern rather than
// silently changing policy.
//
// Credit repayment ("70%/90% credit after deployment... repaid over 6
// months") is expressed as 6 equal "Installment N of 6" stages, all
// triggered at departure_arrival_support — same pattern already used for
// every existing Credit Service Job (Albania's 9, Portugal/Spain's 12,
// etc.), just with the payment split defined by the PDF (15/15/70 for
// six countries, 10/0/90 for Cyprus & Croatia).
//
//   DATABASE_URL="..." npx tsx scripts/create-standard-european-jobs.ts

const STANDARD_CREDIT_STAGES = (): { order: number; label: string; percent: number; trigger_stage: CaseStage }[] => [
  { order: 1, label: "At Application", percent: 15, trigger_stage: "registration_document_submission" },
  { order: 2, label: "After Work Permit Approval", percent: 15, trigger_stage: "permit_authorization_approved" },
  ...Array.from({ length: 6 }, (_, i) => ({
    order: i + 3,
    label: `Installment ${i + 1} of 6`,
    percent: 70 / 6,
    trigger_stage: "departure_arrival_support" as CaseStage,
  })),
];

const CYPRUS_CROATIA_CREDIT_STAGES = (): { order: number; label: string; percent: number; trigger_stage: CaseStage }[] => [
  { order: 1, label: "At Application", percent: 10, trigger_stage: "registration_document_submission" },
  ...Array.from({ length: 6 }, (_, i) => ({
    order: i + 2,
    label: `Installment ${i + 1} of 6`,
    percent: 90 / 6,
    trigger_stage: "departure_arrival_support" as CaseStage,
  })),
];

const NON_CREDIT_STAGES: { order: number; label: string; percent: number; trigger_stage: CaseStage }[] = [
  { order: 1, label: "Documentation", percent: 25, trigger_stage: "registration_document_submission" },
  { order: 2, label: "Work Permit", percent: 25, trigger_stage: "permit_authorization_approved" },
  { order: 3, label: "Visa", percent: 50, trigger_stage: "visa_interview_decision" },
];

interface Position {
  title: string;
  city: string;
  eurTarget: number;
  sector: string;
}

interface CountryProgramme {
  country: string;
  cities: string; // joined display string, e.g. "Tampere / Turku"
  category: string; // primary Job.category
  sectorGroupLabel: string; // as titled in the PDF, e.g. "Manufacturing & Industrial Support"
  positions: Position[];
  creditFeeGbp: number;
  nonCreditFeeGbp: number;
  creditStages: () => { order: number; label: string; percent: number; trigger_stage: CaseStage }[];
  requirementsExtra?: string;
}

const PROGRAMMES: CountryProgramme[] = [
  {
    country: "Finland",
    cities: "Tampere / Turku",
    category: "Manufacturing & Production",
    sectorGroupLabel: "Manufacturing & Industrial Support",
    creditFeeGbp: 3800,
    nonCreditFeeGbp: 3200,
    creditStages: STANDARD_CREDIT_STAGES,
    positions: [
      { title: "Manufacturing Worker", city: "Tampere", eurTarget: 1700, sector: "Manufacturing & Production" },
      { title: "Production Worker", city: "Turku", eurTarget: 1800, sector: "Manufacturing & Production" },
      { title: "Industrial Support Worker", city: "Tampere", eurTarget: 1900, sector: "Manufacturing & Production" },
      { title: "Factory Assistant", city: "Turku", eurTarget: 1650, sector: "Manufacturing & Production" },
      { title: "Industrial/Production Assistant", city: "Tampere", eurTarget: 1750, sector: "Manufacturing & Production" },
    ],
  },
  {
    country: "Malta",
    cities: "Sliema / St. Julian's",
    category: "Hospitality",
    sectorGroupLabel: "Hospitality",
    creditFeeGbp: 4000,
    nonCreditFeeGbp: 3400,
    creditStages: STANDARD_CREDIT_STAGES,
    requirementsExtra: "For hospitality positions in Malta, the stated salary is the basic net salary — service charge, tips, and approved overtime are additional where applicable.",
    positions: [
      { title: "Housekeeping Worker", city: "Sliema", eurTarget: 1250, sector: "Hospitality" },
      { title: "Assistant Waitress", city: "St. Julian's", eurTarget: 1300, sector: "Hospitality" },
      { title: "Kitchen Helper", city: "Sliema", eurTarget: 1250, sector: "Hospitality" },
      { title: "Cleaner", city: "St. Julian's", eurTarget: 1250, sector: "Hospitality" },
      { title: "Hotel/Hospitality Support Worker", city: "Sliema", eurTarget: 1300, sector: "Hospitality" },
    ],
  },
  {
    country: "Cyprus",
    cities: "Limassol / Larnaca",
    category: "Construction & Trades",
    sectorGroupLabel: "Construction",
    creditFeeGbp: 3000,
    nonCreditFeeGbp: 2400,
    creditStages: CYPRUS_CROATIA_CREDIT_STAGES,
    positions: [
      { title: "Construction Worker", city: "Larnaca", eurTarget: 1400, sector: "Construction & Trades" },
      { title: "General Construction Labourer", city: "Limassol", eurTarget: 1300, sector: "Construction & Trades" },
      { title: "Construction Assistant", city: "Limassol", eurTarget: 1350, sector: "Construction & Trades" },
      { title: "Site Support Worker", city: "Larnaca", eurTarget: 1350, sector: "Construction & Trades" },
    ],
  },
  {
    country: "Croatia",
    cities: "Split / Rijeka",
    category: "Construction & Trades",
    sectorGroupLabel: "Construction & Warehouse",
    creditFeeGbp: 3500,
    nonCreditFeeGbp: 2900,
    creditStages: CYPRUS_CROATIA_CREDIT_STAGES,
    positions: [
      { title: "Construction Worker", city: "Split", eurTarget: 1250, sector: "Construction & Trades" },
      { title: "Construction Assistant", city: "Rijeka", eurTarget: 1150, sector: "Construction & Trades" },
      { title: "Warehouse Worker", city: "Rijeka", eurTarget: 1200, sector: "Logistics & Warehousing" },
      { title: "Warehouse/Loading Assistant", city: "Rijeka", eurTarget: 1150, sector: "Logistics & Warehousing" },
      { title: "General Labourer", city: "Split", eurTarget: 1100, sector: "General / Unskilled" },
    ],
  },
  {
    country: "Greece",
    cities: "Thessaloniki / Patras",
    category: "Construction & Trades",
    sectorGroupLabel: "Construction & Agriculture",
    creditFeeGbp: 3300,
    nonCreditFeeGbp: 2700,
    creditStages: STANDARD_CREDIT_STAGES,
    positions: [
      { title: "Construction Worker", city: "Thessaloniki", eurTarget: 1200, sector: "Construction & Trades" },
      { title: "Construction Labourer", city: "Thessaloniki", eurTarget: 1100, sector: "Construction & Trades" },
      { title: "Agricultural Worker", city: "Patras", eurTarget: 1050, sector: "Agriculture" },
      { title: "Farm/Harvest Worker", city: "Patras", eurTarget: 1050, sector: "Agriculture" },
      { title: "General Agricultural Labourer", city: "Patras", eurTarget: 1000, sector: "Agriculture" },
    ],
  },
  {
    country: "Estonia",
    cities: "Tartu / Narva",
    category: "Manufacturing & Production",
    sectorGroupLabel: "Factory & Warehouse",
    creditFeeGbp: 2800,
    nonCreditFeeGbp: 2200,
    creditStages: STANDARD_CREDIT_STAGES,
    positions: [
      { title: "Factory Worker", city: "Narva", eurTarget: 1300, sector: "Manufacturing & Production" },
      { title: "Production Worker", city: "Tartu", eurTarget: 1400, sector: "Manufacturing & Production" },
      { title: "Packaging Worker", city: "Tartu", eurTarget: 1200, sector: "Manufacturing & Production" },
      { title: "Warehouse Worker", city: "Narva", eurTarget: 1300, sector: "Logistics & Warehousing" },
      { title: "Manufacturing Assistant", city: "Narva", eurTarget: 1250, sector: "Manufacturing & Production" },
    ],
  },
  {
    country: "Luxembourg",
    cities: "Esch-sur-Alzette / Differdange",
    category: "Construction & Trades",
    sectorGroupLabel: "Construction & Industrial Support",
    creditFeeGbp: 5500,
    nonCreditFeeGbp: 4900,
    creditStages: STANDARD_CREDIT_STAGES,
    positions: [
      { title: "Construction Worker", city: "Esch-sur-Alzette", eurTarget: 2500, sector: "Construction & Trades" },
      { title: "Construction Assistant", city: "Esch-sur-Alzette", eurTarget: 2400, sector: "Construction & Trades" },
      { title: "Industrial Support Worker", city: "Differdange", eurTarget: 2550, sector: "Manufacturing & Production" },
      { title: "Maintenance Assistant", city: "Differdange", eurTarget: 2650, sector: "Manufacturing & Production" },
      { title: "Industrial/Production Support Worker", city: "Differdange", eurTarget: 2500, sector: "Manufacturing & Production" },
    ],
  },
  {
    country: "Italy",
    cities: "Milan / Turin",
    category: "Transport & Delivery",
    sectorGroupLabel: "Delivery & Logistics",
    creditFeeGbp: 3500,
    nonCreditFeeGbp: 2900,
    creditStages: STANDARD_CREDIT_STAGES,
    positions: [
      { title: "Delivery Worker", city: "Milan", eurTarget: 1350, sector: "Transport & Delivery" },
      { title: "Courier/Parcel Delivery Worker", city: "Milan", eurTarget: 1450, sector: "Transport & Delivery" },
      { title: "Warehouse Worker", city: "Turin", eurTarget: 1300, sector: "Logistics & Warehousing" },
      { title: "Logistics Assistant", city: "Milan", eurTarget: 1500, sector: "Logistics & Warehousing" },
      { title: "Distribution/Logistics Support Worker", city: "Turin", eurTarget: 1350, sector: "Logistics & Warehousing" },
    ],
  },
];

const REQUIREMENTS_BASE =
  "Valid passport with sufficient validity for the immigration process; updated CV; relevant employment experience where required; educational or vocational certificates where applicable; employment references where available; police clearance where required; medical documentation where required; genuine and verifiable personal documents; ability to perform the duties of the selected position; willingness to work according to the employer's schedule; ability to comply with workplace rules and safety requirements; and required language ability where applicable. Some positions may require additional qualifications, professional licences, driving licences, technical certificates, or documented experience.";

function buildDescription(p: CountryProgramme): string {
  const roles = p.positions
    .map((pos) => `${pos.title} (${pos.city}, target net €${pos.eurTarget.toLocaleString()}/month)`)
    .join(", ");
  return `Standard European Work Permit Program — ${p.sectorGroupLabel} opportunities in ${p.country}, with vacancies across ${roles}. 2-year employment contract under Visa D (issued in accordance with applicable national laws). All salaries stated are target net monthly figures; the actual amount received may vary according to the employee's individual tax position, statutory deductions, working hours, and applicable employment regulations. The positions listed are priority employment categories subject to employer availability — the exact employer, position, salary, working hours, and workplace will be confirmed through the official employment documentation. Includes job placement, employment contract, employer coordination, work permit application and processing, document preparation, translation and legalization where required, embassy and visa assistance, and pre-departure, relocation, and initial settlement support.`;
}

function buildRequirements(p: CountryProgramme): string {
  return p.requirementsExtra ? `${REQUIREMENTS_BASE} ${p.requirementsExtra}` : REQUIREMENTS_BASE;
}

async function createJobWithSectorsAndStages(
  title: string,
  p: CountryProgramme,
  serviceFeeGbp: number,
  isCreditService: boolean,
  partnerOnly: boolean,
  stages: { order: number; label: string; percent: number; trigger_stage: CaseStage }[]
) {
  const existing = await prisma.job.findFirst({ where: { title } });
  if (existing) {
    console.log(`- ${title}: already exists, skipping`);
    return existing.id;
  }

  const sectorNames = [...new Set(p.positions.map((pos) => pos.sector))];

  const job = await prisma.job.create({
    data: {
      title,
      country: p.country,
      city: p.cities,
      category: p.category,
      job_description: buildDescription(p),
      requirements: buildRequirements(p),
      status: "active",
      application_fee: 0,
      visa_type: "Visa D",
      duration_permit: "2 years",
      processing_time: "3-4 months",
      service_fee_gbp: serviceFeeGbp,
      is_credit_service: isCreditService,
      partner_only: partnerOnly,
      payment_stages: { create: stages },
      sectors: {
        create: sectorNames.map((sector) => ({
          sector,
          positions: { create: p.positions.filter((pos) => pos.sector === sector).map((pos) => ({ title: pos.title, city: pos.city })) },
        })),
      },
    },
  });

  console.log(`- ${title}: created (${stages.length} payment stage(s), ${sectorNames.length} sector(s), ${p.positions.length} position(s))`);
  return job.id;
}

async function main() {
  const createdJobIds: string[] = [];

  for (const p of PROGRAMMES) {
    const nonCreditTitle = `${p.country} — ${p.sectorGroupLabel} (Standard Programme)`;
    const creditTitle = `${p.country} — ${p.sectorGroupLabel} (Credit Service Programme)`;

    const nonCreditId = await createJobWithSectorsAndStages(nonCreditTitle, p, p.nonCreditFeeGbp, false, false, NON_CREDIT_STAGES);
    createdJobIds.push(nonCreditId);

    const creditId = await createJobWithSectorsAndStages(creditTitle, p, p.creditFeeGbp, true, true, p.creditStages());
    createdJobIds.push(creditId);
  }

  console.log("\nProvisioning receipt document types and Stripe pricing...");
  for (const jobId of createdJobIds) {
    await ensurePaymentReceiptDocumentTypes(jobId);
    try {
      await syncJobMilestonePricing(jobId);
    } catch (err) {
      console.error(`  ! Stripe sync failed for job ${jobId}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone. ${createdJobIds.length} job(s) processed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
