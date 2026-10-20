import { PrismaClient, type CaseStage } from "@prisma/client";
import { syncJobMilestonePricing } from "../src/server/services/stripeProvisioning";
import { ensurePaymentReceiptDocumentTypes } from "../src/server/services/paymentReceiptTypes";

const prisma = new PrismaClient();

// Best-effort Stripe pricing for a seeded job: a Stripe outage or
// misconfiguration must never block the seed. Without a key at all (CI, the
// local test scripts) there's nothing to sync to, so skip the call instead
// of sending every job to Stripe with the build-time placeholder key.
const hasStripeKey = Boolean(process.env.STRIPE_SECRET_KEY);
if (!hasStripeKey) console.log("STRIPE_SECRET_KEY not set: skipping Stripe pricing sync for seeded jobs.");
function syncPricing(jobId: string, label: string) {
  if (!hasStripeKey) return Promise.resolve();
  return syncJobMilestonePricing(jobId).catch((err) =>
    console.error(`Failed to sync Stripe pricing for ${label}.`, err)
  );
}

// Reproduces the 3 payment-plan shapes this seed's Jobs use (2026-09-16,
// flexible per-Job payment stages) — same formulas as
// scripts/backfill-job-payment-stages.ts, kept idempotent by skipping any
// Job that already has payment_stages (so a reseed never duplicates rows
// or clobbers stages an admin edited by hand on a dev database).
async function ensurePaymentStages(jobId: string, stagesData: { order: number; label: string; percent: number; trigger_stage: CaseStage }[]) {
  const existingCount = await prisma.jobPaymentStage.count({ where: { job_id: jobId } });
  if (existingCount > 0) return;
  await prisma.jobPaymentStage.createMany({ data: stagesData.map((s) => ({ ...s, job_id: jobId })) });
  await ensurePaymentReceiptDocumentTypes(jobId);
}

const STANDARD_PAYMENT_STAGES: { order: number; label: string; percent: number; trigger_stage: CaseStage }[] = [
  { order: 1, label: "Documentation", percent: 25, trigger_stage: "registration_document_submission" },
  { order: 2, label: "Work Permit", percent: 25, trigger_stage: "permit_authorization_approved" },
  { order: 3, label: "Visa", percent: 50, trigger_stage: "visa_interview_decision" },
];

const TWO_STAGE_PAYMENT_STAGES: { order: number; label: string; percent: number; trigger_stage: CaseStage }[] = [
  { order: 1, label: "Documentation", percent: 50, trigger_stage: "registration_document_submission" },
  { order: 2, label: "Visa", percent: 50, trigger_stage: "visa_interview_decision" },
];

function creditPaymentStages(financingPercent: number, installmentCount: number): { order: number; label: string; percent: number; trigger_stage: CaseStage }[] {
  const stages: { order: number; label: string; percent: number; trigger_stage: CaseStage }[] = [
    { order: 1, label: "Upfront", percent: 100 - financingPercent, trigger_stage: "registration_document_submission" },
  ];
  const perInstallment = financingPercent / installmentCount;
  for (let i = 0; i < installmentCount; i++) {
    stages.push({ order: i + 2, label: `Installment ${i + 1} of ${installmentCount}`, percent: perInstallment, trigger_stage: "departure_arrival_support" });
  }
  return stages;
}

// Baseline reference data matching the regions already described on the
// public site (About page hubs: European Command, Middle East & Gulf
// Operations, Africa Regional Directorate). Admins can add more via the UI.
// Europe's country list is also the Candidate Information Form's "Preferred
// Programme / Country" dropdown (Section 1) — these are the programme
// destinations actually named in that form's Section 3 document checklist,
// plus the UK as Vertex's own operating base.
// Portugal, Spain and Czech Republic added alongside the original 2026-07
// list — they're 3 of the 15 work-permit programmes in the Service &
// Pricing List but were missing from this destination list entirely, so
// the CIF's country picker couldn't select them at all. Greece,
// Netherlands and Croatia added the same way for the 2026 pricing
// revision (2026-07-31) — 3 new programmes in the updated Service &
// Pricing List with no destination Country to pick from yet. Albania and
// Belgium added for the European Credit Service Programme (2026-08-29) —
// their only Job entries are partner_only: true (see CREDIT_SERVICE_JOBS
// below), so they're selectable on the general CIF country picker with no
// public-facing Job to apply to there — cosmetic, not a data risk (see
// the Credit Service Programme plan's own note on this).
const REGIONS: Record<string, string[]> = {
  Europe: ["United Kingdom", "Poland", "Belarus", "Italy", "Hungary", "Romania", "Serbia", "Bulgaria", "Slovakia", "Germany", "Portugal", "Spain", "Czech Republic", "Greece", "Netherlands", "Croatia", "Albania", "Belgium"],
  "Middle East & Gulf": ["United Arab Emirates", "Saudi Arabia", "Qatar"],
  Africa: ["Kenya", "Uganda", "Nigeria", "Ghana"],
};

// Default sector list drawn from the Candidate Information Form's "Preferred
// Type of Work" examples (warehouse, agriculture, hotel, driving) plus the
// programme documents referenced in its Section 3 checklist. Admin can add
// or rename these via the Sector management UI. "General Labour" added
// alongside the work-permit-programme Job seed below — several programmes
// (Portugal, Spain, Poland, Romania, Germany, Czech Republic) are simply
// "Unskilled" with no more specific sector fit.
const SECTORS = ["Warehouse & Logistics", "Agriculture", "Hospitality & Hotel", "Driving", "Construction", "Manufacturing", "General Labour"];

// Baseline document requirement types (replaces the old fixed DocumentType
// enum) — admin can add more from the Sectors & Requirements page. Order
// and labels match the real Candidate Information Form's Section 3
// exactly; is_universal marks the 3 required for every programme
// regardless of destination.
const DOCUMENT_REQUIREMENT_TYPES: { key: string; label: string; is_universal?: boolean; sort_order: number }[] = [
  { key: "cv", label: "CV / Resume", is_universal: true, sort_order: 0 },
  { key: "passport", label: "Passport Copy — first page", is_universal: true, sort_order: 1 },
  { key: "all_passport_pages", label: "All Passport Pages (good quality)", sort_order: 2 },
  { key: "passport_photo", label: "Passport-Size Photos", is_universal: true, sort_order: 3 },
  { key: "national_id", label: "National ID Copy", sort_order: 4 },
  { key: "cv_europass", label: "CV in Europass format", sort_order: 5 },
  { key: "education_diploma", label: "Education Diploma", sort_order: 6 },
  { key: "police_clearance", label: "Criminal Record Certificate", sort_order: 7 },
  { key: "driving_licence", label: "Driving Licence — Category CE", sort_order: 8 },
  { key: "tachograph_card", label: "Tachograph Card + Code 95", sort_order: 9 },
  { key: "professional_training_certificate", label: "Professional Training Certificate", sort_order: 10 },
  { key: "e_apostille", label: "e-Apostille", sort_order: 11 },
  { key: "zab_recognition_letter", label: "ZAB Recognition Letter (skilled employees)", sort_order: 12 },
  // Broader Phase 4 mobility-lifecycle document set (not part of the CIF/
  // Agency self-report checklist — staff upload these ad hoc from a case).
  { key: "transcript", label: "Transcript", sort_order: 13 },
  { key: "certificate", label: "Certificate", sort_order: 14 },
  { key: "medical", label: "Medical Report", sort_order: 15 },
  { key: "contract", label: "Contract", sort_order: 16 },
  { key: "visa", label: "Visa", sort_order: 17 },
  { key: "other", label: "Other Document", sort_order: 18 },
  // Operations delivering a government-issued document back onto the case
  // (2026-07-31, per the Operational Workflow SOP) — never a candidate/
  // partner self-report item, only ever staff-uploaded from CaseDetail.
  { key: "issued_work_permit", label: "Issued Work Permit", sort_order: 19 },
  { key: "issued_visa", label: "Issued Visa", sort_order: 20 },
  // A staff-uploaded receipt for a manually-recorded milestone payment
  // (2026-07-31 — Stripe restricted to self-applicants; partner/recruiter-
  // sourced payments are recorded with a receipt instead). Kept only for
  // backward compatibility with payments recorded before the 2026-08-19
  // per-milestone split below — nothing uploads against this key anymore.
  { key: "payment_receipt", label: "Payment Receipt (legacy)", sort_order: 21 },
  // Split into one key per milestone (2026-08-19) — a shared key across
  // all three stages meant uploading a Visa receipt superseded (deleted)
  // whichever Document row was previously serving as the Documentation or
  // Permit receipt, silently nulling out those payments' own
  // receipt_document_id (onDelete: SetNull) once all three were paid.
  { key: "payment_receipt_documentation", label: "Payment Receipt — Documentation", sort_order: 22 },
  { key: "payment_receipt_permit", label: "Payment Receipt — Permit", sort_order: 23 },
  { key: "payment_receipt_visa", label: "Payment Receipt — Visa", sort_order: 24 },
  // Credit Service Programme's single upfront payment (2026-08-29) — same
  // one-key-per-stage rationale as the 3 above.
  { key: "payment_receipt_upfront", label: "Payment Receipt — Upfront", sort_order: 25 },
];

// The 15 work-permit programmes from the 2026 Service & Pricing List for
// Candidates ("Price List 2026" sheet, replacing the original 2026-07 Work
// Permits sheet), seeded as real Job rows so they're the actual public
// /jobs listings rather than a separate hardcoded catalog — "Apply" on any
// of them carries job_id through to the Candidate Information Form
// (POST /api/applications already supports it end to end). Pricing is
// deliberately per-programme (per row here), not per-country: several
// countries carry more than one tier of programme historically, so a
// country-keyed price table would be wrong. Every programme in the 2026
// sheet follows the same fixed 25% / 25% / 50% (documentation / permit /
// visa) split of the total service fee (was 20/40/40) — stage amounts are
// derived from service_fee_gbp at render time rather than stored.
const ACCOMMODATION_NOTE = "Accommodation is provided in every programme (may be deducted from salary).";
const JOBS: {
  title: string;
  country: string;
  category: string;
  tier: string;
  salary_range: string;
  job_description: string;
  requirements: string;
  visa_type: string;
  duration_permit: string;
  processing_time: string;
  service_fee_gbp: number;
  visa_success_rates: string;
}[] = [
  {
    title: "Italy — Agricultural Worker (2-Year Resident Card)",
    country: "Italy",
    category: "Agriculture",
    tier: "Premium",
    salary_range: "From 1,300 EUR / month",
    job_description: `Agricultural work on a Visa D with a 2-year resident card, processed in around 3 months — the strongest visa success profile in the programme lineup, above 95% in every applicant region. ${ACCOMMODATION_NOTE}`,
    requirements: "First page of the passport and CV in Europass format.",
    visa_type: "Visa D",
    duration_permit: "2-year resident card",
    processing_time: "3 months",
    service_fee_gbp: 2400,
    visa_success_rates: "Asia: above 95% · Africa: above 95% · South America: above 95%",
  },
  {
    title: "Greece — Hospitality Worker (1-Year Employment Contract)",
    country: "Greece",
    category: "Hospitality",
    tier: "Premium",
    salary_range: "1,200–1,350 EUR / month",
    job_description: `Hospitality-sector work (kitchen, housekeeping, or hotel staff) on a Visa D1, with a 1-year employment contract processed in around 3 months. ${ACCOMMODATION_NOTE}`,
    requirements: "First page of the passport and CV in Europass format.",
    visa_type: "Visa D1",
    duration_permit: "1-year employment contract",
    processing_time: "3 months",
    service_fee_gbp: 2100,
    visa_success_rates: "Asia: 95% · Africa: 95% · South America: 95%",
  },
  {
    title: "Netherlands — Healthcare Worker (1-Year Employment Contract)",
    country: "Netherlands",
    category: "Healthcare",
    tier: "Premium",
    salary_range: "1,800 EUR / month",
    job_description: `Unskilled healthcare-sector work on a Visa D1, with a 1-year employment contract processed in around 4 months. ${ACCOMMODATION_NOTE}`,
    requirements: "First page of the passport and CV in Europass format.",
    visa_type: "Visa D1",
    duration_permit: "1-year employment contract",
    processing_time: "4 months",
    service_fee_gbp: 2200,
    visa_success_rates: "Asia: 80% · Africa: 80% · South America: 80%",
  },
  {
    title: "Germany — Unskilled Worker (180-Day Visa + Resident Card)",
    country: "Germany",
    category: "General / Unskilled",
    tier: "Premium",
    salary_range: "From 2,200 EUR / month",
    job_description: `Unskilled work on a Visa D, combining a 180-day visa with a 1–2 year resident card. Documents process in around 4 months. Skilled applicants should also prepare a ZAB recognition letter. ${ACCOMMODATION_NOTE}`,
    requirements: "Photo of the first page of the passport and CV. Skilled employees also need a ZAB recognition letter.",
    visa_type: "Visa D",
    duration_permit: "180-day visa + 1–2 year resident card",
    processing_time: "4 months",
    service_fee_gbp: 1800,
    visa_success_rates: "Asia: 60–75% · Africa: 75–85% · South America: 75–85%",
  },
  {
    title: "Bulgaria — Hotel Sector Worker (6-Month Contract)",
    country: "Bulgaria",
    category: "Hospitality",
    tier: "Standard",
    salary_range: "750–1,400 EUR / month",
    job_description: `Unskilled hotel-sector work (hotel staff, kitchen assistant, housekeeping, or gardener assistant) on a Visa D. An initial visa is issued for up to 90 days, attached to a 6-month employment contract; documents process in around 3 months. Salary depends on the exact position and working hours. ${ACCOMMODATION_NOTE}`,
    requirements: "Scanned copy of international passport, criminal record certificate, and CV.",
    visa_type: "Visa D",
    duration_permit: "Initial visa up to 90 days · 6-month contract",
    processing_time: "3 months",
    service_fee_gbp: 1800,
    visa_success_rates: "Asia: 70–80% · Africa: 85–95% · South America: above 95%",
  },
  {
    title: "Portugal — Unskilled Worker (12-Month Employment Contract)",
    country: "Portugal",
    category: "General / Unskilled",
    tier: "Standard",
    salary_range: "870 EUR / month",
    job_description: `Unskilled work on a 12-month employment contract (Visa D1), processed in around 3 months with a scheduled embassy appointment. ${ACCOMMODATION_NOTE}`,
    requirements: "Photo of the first page of the passport.",
    visa_type: "Visa D1",
    duration_permit: "12-month employment contract",
    processing_time: "3 months",
    service_fee_gbp: 1600,
    visa_success_rates: "Asia: 70–80% · Africa: 85–95% · South America: above 95%",
  },
  {
    title: "Spain — Unskilled Worker (12-Month Employment Contract)",
    country: "Spain",
    category: "General / Unskilled",
    tier: "Standard",
    salary_range: "870 EUR / month",
    job_description: `Unskilled work on a 12-month employment contract (Visa D1), processed in around 3 months with a scheduled embassy appointment. ${ACCOMMODATION_NOTE}`,
    requirements: "Photo of the first page of the passport.",
    visa_type: "Visa D1",
    duration_permit: "12-month employment contract",
    processing_time: "3 months",
    service_fee_gbp: 1600,
    visa_success_rates: "Asia: 70–80% · Africa: 85–95% · South America: above 95%",
  },
  {
    title: "Croatia — Construction Worker (1-Year Employment Contract)",
    country: "Croatia",
    category: "Construction & Trades",
    tier: "Standard",
    salary_range: "1,100 EUR / month",
    job_description: `Construction work on a Visa D1, with a 1-year employment contract processed in around 3 months. ${ACCOMMODATION_NOTE}`,
    requirements: "First page of the passport and CV in Europass format.",
    visa_type: "Visa D1",
    duration_permit: "1-year employment contract",
    processing_time: "3 months",
    service_fee_gbp: 1600,
    visa_success_rates: "Asia: 85% · Africa: 85% · South America: 85%",
  },
  {
    title: "Hungary — Assistant Agronomist (6-Month Employment Contract)",
    country: "Hungary",
    category: "Agriculture",
    tier: "Standard",
    salary_range: "900–940 EUR / month",
    job_description: `Unskilled work as an assistant agronomist on a Visa D, with a 6-month employment contract processed in around 5 months. ${ACCOMMODATION_NOTE}`,
    requirements: "First page of the passport and CV in Europass format.",
    visa_type: "Visa D",
    duration_permit: "6-month employment contract",
    processing_time: "5 months",
    service_fee_gbp: 1600,
    visa_success_rates: "Asia: 60–75% · Africa: 75–85% · South America: 75–85%",
  },
  {
    title: "Slovakia — Truck Driver, Category CE (Skilled)",
    country: "Slovakia",
    category: "Transport & Delivery",
    tier: "Skilled",
    salary_range: "2,250 EUR / month",
    job_description: `Skilled work as a Category CE truck driver, with official employment and a 2-year residence permit on a Visa D — the highest fixed salary in the programme lineup. Documents process in around 3 months; requires an embassy appointment. ${ACCOMMODATION_NOTE}`,
    requirements: "Passport; driving licence (Category CE); tachograph card; Code 95 (assistance with registration available if not already held).",
    visa_type: "Visa D",
    duration_permit: "Official employment + 2-year residence permit",
    processing_time: "3 months",
    service_fee_gbp: 1550,
    visa_success_rates: "Asia: 60–75% · Africa: 75–85% · South America: 75–85%",
  },
  {
    title: "Czech Republic — 2-Year Resident Card",
    country: "Czech Republic",
    category: "General / Unskilled",
    tier: "Standard",
    salary_range: "From 830 EUR / month",
    job_description: `Unskilled work on a Visa D with a 2-year resident card, processed in around 3 months. ${ACCOMMODATION_NOTE}`,
    requirements: "Photo of the first page of the passport.",
    visa_type: "Visa D",
    duration_permit: "2-year resident card",
    processing_time: "3 months",
    service_fee_gbp: 1550,
    visa_success_rates: "Asia: 60–75% · Africa: 75–85% · South America: 75–85%",
  },
  {
    title: "Romania — Unskilled Worker (2-Year Resident Card)",
    country: "Romania",
    category: "General / Unskilled",
    tier: "Standard",
    salary_range: "From 700 EUR / month",
    job_description: `Unskilled work on a Visa D with a 2-year resident card, processed in around 4 months. ${ACCOMMODATION_NOTE}`,
    requirements: "First page of the passport and CV in Europass format.",
    visa_type: "Visa D",
    duration_permit: "2-year resident card",
    processing_time: "4 months",
    service_fee_gbp: 1550,
    visa_success_rates: "Asia: 70–80% · Africa: 85–95% · South America: above 95%",
  },
  {
    title: "Poland — Unskilled Worker (12- or 18-Month Work Permit)",
    country: "Poland",
    category: "General / Unskilled",
    tier: "Standard",
    salary_range: "From 1,000 EUR / month",
    job_description: `Unskilled work on a Visa D, with a choice of 12-month or 18-month work permit. ${ACCOMMODATION_NOTE}`,
    requirements: "All pages of the passport, in good quality.",
    visa_type: "Visa D",
    duration_permit: "12-month or 18-month work permit",
    processing_time: "3 months (12-month permit) · 3–4 months (18-month permit)",
    service_fee_gbp: 1500,
    visa_success_rates: "Asia: 60–75% · Africa: 75–85% · South America: 75–85%",
  },
  {
    title: "Serbia — Warehouse Worker (6-Month Work Permit)",
    country: "Serbia",
    category: "Logistics & Warehousing",
    tier: "Entry",
    salary_range: "940 EUR / month",
    job_description: `Warehouse worker programme on a Visa D, with a 6-month engagement that can be extended via a temporary residence card (TRC). Documents process in around 2 months. ${ACCOMMODATION_NOTE}`,
    requirements: "Passport, education diploma, and completed application form.",
    visa_type: "Visa D",
    duration_permit: "6 months · TRC possible",
    processing_time: "2 months",
    service_fee_gbp: 1400,
    visa_success_rates: "Asia: above 90% · Africa: 90–95% · South America: above 95%",
  },
  {
    title: "Belarus — Production & Construction Vacancies (3-Year TRC)",
    country: "Belarus",
    category: "Construction & Trades",
    tier: "Entry",
    salary_range: "434–1,085 EUR / month",
    job_description: `Vacancies across General Worker (production), Painter, Plasterer/finishing, and Production Assistant (no experience required) roles on a Visa D. A 30-day entry visa is followed by a temporary residence card (TRC) valid for 3 years on arrival; requires an embassy appointment. Documents process in around 2 months. Salary depends on the exact vacancy. ${ACCOMMODATION_NOTE}`,
    requirements: "International passport, passport-size photos, national ID / personal data, professional training certificate, and e-Apostille.",
    visa_type: "Visa D",
    duration_permit: "30-day entry visa · TRC for 3 years on arrival",
    processing_time: "2 months",
    service_fee_gbp: 1400,
    visa_success_rates: "Asia: 85–95% · Africa: 85–95% · South America: 85–95%",
  },
];

// The 6 Credit Service Programme opportunities (European Credit Service
// Programme, Edition 2026) — a second, parallel pricing model to the 15
// programmes above (installment financing instead of the fixed 25/25/50
// milestone split), and partner_only: true throughout — never shown on the
// public /jobs site or the self-service/recruiter-walk-in Candidate
// Information Form (see getPublicJobsList's partner_only filter). Italy,
// Netherlands, Portugal, and Spain already have their own, different
// standard-model Job rows above at the same destinations — these are
// additional parallel programmes, not replacements. financing_percent
// determines the upfront/financed split; installment_count is stored
// explicitly since it isn't derivable from financing_percent alone (see
// computeCreditServiceSchedule, src/lib/fees.ts). processing_time is left
// as the source document's own general "Processing" term (starts once
// documentation and any applicable initial payment are received) rather
// than a fabricated per-country figure, since the PDF gives none.
const CREDIT_SERVICE_JOBS: {
  title: string;
  country: string;
  city: string;
  category: string;
  salary_range: string;
  job_description: string;
  requirements: string;
  visa_type: string;
  duration_permit: string;
  processing_time: string;
  service_fee_gbp: number;
  financing_percent: number;
  installment_count: number;
}[] = [
  {
    title: "Albania — Skilled Construction Programme (Credit Service)",
    country: "Albania",
    city: "Tirana / Elbasan",
    category: "Construction & Trades",
    salary_range: "Role / employer dependent",
    job_description:
      "Skilled construction work at employer-assigned project locations, with vacancies across Plumber (installation, maintenance, pipework, fittings, sanitary systems, and repairs), Electrician (electrical installation, wiring, fixtures, testing, and maintenance within authorised scope), Mason/Bricklayer (brick/block work, mortar preparation, and structural/finishing masonry), and Other skilled trades (additional skilled construction trades per employer demand). 12-month renewable contract, full-time on a site schedule. Accommodation is employer/project-dependent. Financed under the Credit Service Programme — 100% financing, no upfront Credit Service Fee payment, repaid over 9 monthly installments of £200 after placement.",
    requirements:
      "Valid passport with sufficient validity for the immigration process. Professional trade qualification or certificate relevant to the submitted role. Evidence of practical experience in the relevant skilled trade. Police Clearance Certificate and Medical Fitness Certificate. Physically fit for construction-site work and able to comply with site safety requirements. Trade certificates and professional documents authenticated/legalised where required.",
    visa_type: "Unique Permit (Leje Unike) + Type D visa where applicable",
    duration_permit: "12 months - renewable",
    processing_time: "Begins once required documentation is received; no upfront payment under 100% financing.",
    service_fee_gbp: 1800,
    financing_percent: 100,
    installment_count: 9,
  },
  {
    title: "Italy — Agriculture Programme (Credit Service)",
    country: "Italy",
    city: "Verona / Bologna / Trento",
    category: "Agriculture",
    salary_range: "From EUR 1,300 / month",
    job_description:
      "Agricultural work across Agricultural Worker (planting, tending, and harvesting per seasonal schedules), Field support (irrigation, watering, and routine field maintenance), Produce handling (sorting, grading, handling, and packing harvested produce), and General farm duties (moving crates/tools/materials safely, assisting with loading). 24-month contract, 40 hours/week. Accommodation is employer-arranged. Financed under the Credit Service Programme — 70% financing, £885 upfront, repaid over 3 installments of £688.33/£688.33/£688.34 after placement.",
    requirements:
      "Minimum age 21 and valid passport. Clean Police Clearance Certificate and Medical Fitness Certificate. Physically fit for outdoor work, standing, bending, and lifting. No previous experience required; farm or harvest experience is an advantage. Basic English or Italian desirable. Able to relocate and complete the employment contract.",
    visa_type: "Nulla osta + national work visa",
    duration_permit: "24 months",
    processing_time: "Begins once the initial payment and complete documentation are received.",
    service_fee_gbp: 2950,
    financing_percent: 70,
    installment_count: 3,
  },
  {
    title: "Netherlands — Healthcare Assistance Programme (Credit Service)",
    country: "Netherlands",
    city: "Amsterdam / Rotterdam / Utrecht",
    category: "Healthcare",
    salary_range: "EUR 1,800 / month",
    job_description:
      "Healthcare assistance work across Healthcare Assistant (supporting residents with personal care and daily living activities), Mobility support (assisting with safe mobility, transfers, and positioning where trained), Meals & routines (supporting meals, hydration, and basic household routines), and Care-team support (observing and reporting changes or concerns to the responsible care team member). 12-month renewable contract, full-time on rostered shifts. Accommodation is arranged by the employer. Financed under the Credit Service Programme — 70% financing, £690 upfront, repaid over 3 installments of £536.67/£536.67/£536.66 after placement.",
    requirements:
      "Minimum age 21; valid passport, clean police clearance, and medical fitness. Previous elderly-care, support-work, or housekeeping experience preferred. Basic English required; Dutch is advantageous and may be employer-required. Manual-handling or first-aid training is an advantage. Comfortable with rotating shifts, including weekends and nights where scheduled. Patient, respectful, and reliable with vulnerable or elderly residents.",
    visa_type: "GVVA / applicable work-residence authorisation",
    duration_permit: "12 months - renewable",
    processing_time: "Begins once the initial payment and complete documentation are received.",
    service_fee_gbp: 2300,
    financing_percent: 70,
    installment_count: 3,
  },
  {
    title: "Belgium — Warehouse Programme (Credit Service)",
    country: "Belgium",
    city: "Liège",
    category: "Logistics & Warehousing",
    salary_range: "EUR 2,200–2,300 / month",
    job_description:
      "Warehouse work across Loader-Warehouse (receiving, unloading, and handling cartons and pallets), Stock handling (moving stock using hand pallet trucks and roll cages), Dispatch support (loading outbound vehicles and supporting dispatch operations), and Warehouse safety (maintaining an organised loading area and following health and safety procedures). 12-month renewable contract, 38 hours/week on shifts. Accommodation is provided by the employer. Financed under the Credit Service Programme — 70% financing, £900 upfront, repaid over 3 installments of £700 after placement.",
    requirements:
      "Valid passport and complete supporting documentation for the work-authorisation process. Spoken French required for workplace communication. Physically fit for warehouse work involving standing, lifting, and regular movement. Able to work scheduled shifts and follow supervisor instructions. Reliable, punctual, and able to work safely as part of a warehouse team. Able to comply with employer safety rules and Belgian immigration requirements.",
    visa_type: "Single Permit + Type D Visa",
    duration_permit: "12 months - renewable",
    processing_time: "Begins once the initial payment and complete documentation are received.",
    service_fee_gbp: 3000,
    financing_percent: 70,
    installment_count: 3,
  },
  {
    title: "Portugal — General Labour Programme (Credit Service)",
    country: "Portugal",
    city: "Lisbon / Porto / Faro / Santarém",
    category: "General / Unskilled",
    salary_range: "EUR 870–900 / month",
    job_description:
      "General labour work across Warehouse Worker in Lisbon (receiving, unloading, checking, and sorting incoming goods; picking, packing, and preparing orders), Food Production Worker in Porto (preparing, portioning, and packaging food products; carrying out visual quality checks), Hotel Housekeeping Assistant in Faro (cleaning and preparing guest rooms, bathrooms, and public areas), and Agricultural Worker in Santarém (supporting planting, cultivation, crop care, and harvesting). 12-month renewable contract, 40 hours/week. Accommodation is provided/assisted. Financed under the Credit Service Programme — 90% financing, £280 upfront, repaid over 12 installments of £210 after placement.",
    requirements:
      "Minimum age 21. Valid passport, CV, and recent photographs. Clean Police Clearance Certificate and Medical Fitness Report/Certificate. Physically fit for the submitted role. No previous experience required for most general roles. Relevant experience and role-specific certificates are advantageous.",
    visa_type: "Visa D1 / residence formalities",
    duration_permit: "12 months - renewable",
    processing_time: "Begins once the initial payment and complete documentation are received.",
    service_fee_gbp: 2800,
    financing_percent: 90,
    installment_count: 12,
  },
  {
    title: "Spain — General Labour Programme (Credit Service)",
    country: "Spain",
    city: "Madrid / Murcia / Barcelona / Valencia",
    category: "General / Unskilled",
    salary_range: "EUR 870–1,000 / month",
    job_description:
      "General labour work across Warehouse Worker in Madrid (receiving, unloading, checking, and sorting incoming goods; picking, packing, and preparing orders), Factory Worker in Barcelona (production-line assembly, packaging, labelling, and basic visual quality checks), Agricultural Worker in Murcia (supporting planting, cultivation, crop care, harvesting, and produce handling), and Hotel Housekeeping Assistant in Valencia (cleaning and preparing guest rooms, bathrooms, and public areas). 12-month renewable contract, full-time on an employer schedule. Accommodation is provided/assisted. Financed under the Credit Service Programme — 90% financing, £280 upfront, repaid over 12 installments of £210 after placement.",
    requirements:
      "Minimum age 21. Valid passport, CV, and recent photographs. Clean Police Clearance Certificate and Medical Fitness Report/Certificate. Physically fit for the submitted role. No previous experience required for most general roles. Relevant experience and role-specific certificates are advantageous.",
    visa_type: "Initial residence/work + visa",
    duration_permit: "12 months - renewable",
    processing_time: "Begins once the initial payment and complete documentation are received.",
    service_fee_gbp: 2800,
    financing_percent: 90,
    installment_count: 12,
  },
];

// Backfill for the Sector -> Opportunity -> Position application-form flow
// (2026-09-02): every programme needs at least one real JobSector/
// JobPosition row from day one, or the public forms would show zero
// selectable positions the moment this ships until Marketing manually
// visits every job. Upserts a JobSector matching the programme's existing
// category, then find-or-creates one default "General Position" under it
// — same idempotent-by-natural-key idiom as the Job loops above (no
// unique key on JobPosition beyond its own id, so find-then-create).
// Marketing can rename/replace/add to this at their own pace afterward.
const DEFAULT_POSITION_TITLE = "General Position";

async function backfillDefaultSectorAndPosition(jobId: string, category: string) {
  const sector = await prisma.jobSector.upsert({
    where: { job_id_sector: { job_id: jobId, sector: category } },
    update: {},
    create: { job_id: jobId, sector: category },
  });

  const existingPosition = await prisma.jobPosition.findFirst({
    where: { job_sector_id: sector.id, title: DEFAULT_POSITION_TITLE },
  });
  if (!existingPosition) {
    await prisma.jobPosition.create({ data: { job_sector_id: sector.id, title: DEFAULT_POSITION_TITLE } });
  }
}

// Real position catalog from "Positions by Country & Sector" (Partner
// Reference, Edition 2026, 2026-08-27) — every row on the sheet, including
// the ones marked SAMPLE (explicit instruction: those are illustrative
// placeholders per the source doc, not confirmed vacancies, but still real
// enough to seed as selectable positions rather than leaving them out).
// Keyed by the exact Job.title already in JOBS/CREDIT_SERVICE_JOBS above so
// this only ever attaches to a programme that's genuinely on the platform —
// Canada has no matching Job (not in either list, and the PDF itself flags
// it "NOT IN PORTFOLIO") so it's deliberately omitted rather than inventing
// a new programme with fabricated pricing/visa details. Belgium has no
// standard Job, only the Credit Service one, so its positions attach there.
// A header row spanning several cities (e.g. Italy's "Agricultural Worker —
// Verona · Bologna · Trento") becomes one JobPosition per city, matching
// the SAMPLE rows' own per-city granularity.
const PDF_POSITIONS_BY_JOB_TITLE: Record<string, { sector: string; positions: { title: string; city?: string }[] }[]> = {
  "Italy — Agricultural Worker (2-Year Resident Card)": [
    {
      sector: "Agriculture",
      positions: [
        { title: "Agricultural Worker", city: "Verona" },
        { title: "Agricultural Worker", city: "Bologna" },
        { title: "Agricultural Worker", city: "Trento" },
        { title: "Grape Picker", city: "Verona" },
        { title: "Fruit Packer", city: "Bologna" },
        { title: "Apple Picker", city: "Trento" },
      ],
    },
  ],
  "Portugal — Unskilled Worker (12-Month Employment Contract)": [
    { sector: "Logistics & Warehousing", positions: [{ title: "Warehouse Worker", city: "Lisbon" }] },
    { sector: "Hospitality", positions: [{ title: "Hotel Housekeeping", city: "Faro" }] },
    {
      sector: "General / Unskilled",
      positions: [
        { title: "Food Factory Worker", city: "Lisbon" },
        { title: "Kitchen Assistant", city: "Faro" },
      ],
    },
  ],
  "Spain — Unskilled Worker (12-Month Employment Contract)": [
    { sector: "Logistics & Warehousing", positions: [{ title: "Warehouse Worker", city: "Madrid" }] },
    { sector: "Manufacturing & Production", positions: [{ title: "Factory Worker", city: "Barcelona" }] },
    {
      sector: "General / Unskilled",
      positions: [
        { title: "Order Picker", city: "Madrid" },
        { title: "Car Parts Assembler", city: "Barcelona" },
      ],
    },
  ],
  "Slovakia — Truck Driver, Category CE (Skilled)": [
    {
      sector: "Transport & Delivery",
      positions: [
        { title: "Truck Driver · Category CE", city: "Nitra" },
        { title: "Truck Driver · Category CE", city: "Bratislava" },
        { title: "Delivery Driver", city: "Nitra" },
        { title: "Long-Distance Driver", city: "Bratislava" },
      ],
    },
  ],
  "Serbia — Warehouse Worker (6-Month Work Permit)": [
    {
      sector: "Logistics & Warehousing",
      positions: [
        { title: "Warehouse Worker", city: "Belgrade" },
        { title: "Warehouse Worker", city: "Novi Sad" },
      ],
    },
    {
      sector: "Manufacturing & Production",
      positions: [
        { title: "Factory Worker", city: "Kragujevac" },
        { title: "Factory Worker", city: "Belgrade" },
      ],
    },
    {
      sector: "General / Unskilled",
      positions: [
        { title: "Warehouse Assistant", city: "Belgrade" },
        { title: "Cold Store Worker", city: "Novi Sad" },
        { title: "Car Factory Worker", city: "Kragujevac" },
      ],
    },
  ],
  "Greece — Hospitality Worker (1-Year Employment Contract)": [
    {
      sector: "Hospitality",
      positions: [
        { title: "Kitchen Helper", city: "Athens" },
        { title: "Waiter / Waitress", city: "Athens" },
        { title: "Waiter / Waitress", city: "Thessaloniki" },
        { title: "Hotel Housekeeping", city: "Thessaloniki" },
      ],
    },
  ],
  "Germany — Unskilled Worker (180-Day Visa + Resident Card)": [
    {
      sector: "Manufacturing & Production",
      positions: [
        { title: "General Production Worker", city: "Hamburg" },
        { title: "General Production Worker", city: "Leipzig" },
        { title: "General Production Worker", city: "Dortmund" },
        { title: "Port Worker", city: "Hamburg" },
        { title: "Assembly Line Worker", city: "Leipzig" },
        { title: "Parcel Sorter", city: "Dortmund" },
      ],
    },
  ],
  "Croatia — Construction Worker (1-Year Employment Contract)": [
    {
      sector: "Construction & Trades",
      positions: [
        { title: "Construction Worker", city: "Zagreb" },
        { title: "Construction Worker", city: "Split" },
        { title: "Building Labourer", city: "Zagreb" },
        { title: "Construction Labourer", city: "Split" },
      ],
    },
  ],
  "Netherlands — Healthcare Worker (1-Year Employment Contract)": [
    {
      sector: "Healthcare",
      positions: [
        { title: "Healthcare Assistant", city: "Amsterdam" },
        { title: "Healthcare Assistant", city: "Rotterdam" },
        { title: "Healthcare Assistant", city: "Utrecht" },
        { title: "Care Assistant", city: "Amsterdam" },
        { title: "Home Care Worker", city: "Utrecht" },
      ],
    },
  ],
  "Bulgaria — Hotel Sector Worker (6-Month Contract)": [
    {
      sector: "Hospitality",
      positions: [
        { title: "Receptionist", city: "Sunny Beach" },
        { title: "Housekeeping", city: "Burgas" },
      ],
    },
    {
      sector: "General / Unskilled",
      positions: [
        { title: "Kitchen Assistant", city: "Sunny Beach" },
        { title: "Gardener", city: "Burgas" },
      ],
    },
  ],
  "Belarus — Production & Construction Vacancies (3-Year TRC)": [
    {
      sector: "Construction & Trades",
      positions: [
        { title: "Painter", city: "Minsk" },
        { title: "Plumber", city: "Brest" },
        { title: "Electrician", city: "Gomel" },
      ],
    },
  ],
  "Romania — Unskilled Worker (2-Year Resident Card)": [
    {
      sector: "Transport & Delivery",
      positions: [
        { title: "Food Delivery Courier", city: "Bucharest" },
        { title: "Food Delivery Courier", city: "Cluj-Napoca" },
        { title: "Parcel Delivery Courier", city: "Timisoara" },
        { title: "Parcel Delivery Courier", city: "Brasov" },
      ],
    },
  ],
  "Czech Republic — 2-Year Resident Card": [
    {
      sector: "General / Unskilled",
      positions: [
        { title: "General Unskilled Worker", city: "Prague" },
        { title: "General Unskilled Worker", city: "Brno" },
        { title: "General Unskilled Worker", city: "Ostrava" },
        { title: "Warehouse Worker", city: "Prague" },
        { title: "Electronics Assembler", city: "Brno" },
        { title: "Packer", city: "Ostrava" },
      ],
    },
  ],
  "Hungary — Assistant Agronomist (6-Month Employment Contract)": [
    {
      sector: "Agriculture",
      positions: [
        { title: "Assistant Agronomist", city: "Szeged" },
        { title: "Assistant Agronomist", city: "Kecskemet" },
        { title: "Greenhouse Worker", city: "Szeged" },
        { title: "Field Worker", city: "Kecskemet" },
      ],
    },
  ],
  "Poland — Unskilled Worker (12- or 18-Month Work Permit)": [
    {
      sector: "General / Unskilled",
      positions: [
        { title: "General Unskilled Worker", city: "Employer-assigned" },
        { title: "Order Packer", city: "Warsaw" },
        { title: "Assembly Worker", city: "Poznan" },
        { title: "Electronics Packer", city: "Wroclaw" },
      ],
    },
  ],
  "Belgium — Warehouse Programme (Credit Service)": [
    {
      sector: "Logistics & Warehousing",
      positions: [
        { title: "Packer", city: "Liege" },
        { title: "Loader", city: "Charleroi" },
      ],
    },
  ],
  // Production-only Jobs (2026-09-02) — created directly in production,
  // never added to the JOBS array above, so they're not on dev/staging at
  // all; these entries are a no-op there (findFirst by title returns
  // null) and only take effect in production, where the title match is
  // real. Belgium's title has literal tab characters, copied byte-for-
  // byte from the live row rather than "corrected" — renaming it is a
  // separate concern from attaching sector/position data. The 3 Canada
  // jobs currently have category: "" in production (never categorized)
  // — their sector here is taken from the PDF directly, same as every
  // other entry in this map, not derived from their own category field.
  // Canada's separate 50%-upfront/50%-after-visa pricing/milestone-split
  // work (a different schedule from the standard 25/25/50 split) is not
  // part of this — sector/position data only.
  "Belgium-Manufacturing\t&\tWarehouse": [
    {
      sector: "Logistics & Warehousing",
      positions: [
        { title: "Packer", city: "Liege" },
        { title: "Loader", city: "Charleroi" },
      ],
    },
  ],
  "Canada-Truck Driver-Montreal, Quebec (FRENCH SPEAKERS ONLY)": [
    {
      sector: "Transport & Delivery",
      positions: [{ title: "Truck Driver · French required", city: "Montreal, QC" }],
    },
  ],
  "Canada-Industrial Warehouse & Logistics Support Worker-Quebec City, Quebec (FRENCH SPEAKERS ONLY)": [
    {
      sector: "Logistics & Warehousing",
      positions: [{ title: "Warehouse Worker · French", city: "Quebec City, QC" }],
    },
  ],
  "Canada-Oil & Gas Manufacturing Support Worker-Fort McMurray, Alberta": [
    {
      sector: "Manufacturing & Production",
      positions: [{ title: "Machine Operator Assistant", city: "Fort McMurray, AB" }],
    },
  ],
};

// Applies the PDF catalog above on top of whatever backfillDefaultSectorAndPosition
// already created — upserts each real sector/position, then removes the
// generic "General Position" placeholder now superseded by real data (both
// within a sector that gained real positions, and for a whole placeholder
// sector — e.g. Germany/Romania's category-derived default sector doesn't
// match anything the PDF actually lists for that country).
async function applyPdfPositionCatalog() {
  for (const [jobTitle, sectorsData] of Object.entries(PDF_POSITIONS_BY_JOB_TITLE)) {
    const job = await prisma.job.findFirst({ where: { title: jobTitle } });
    if (!job) continue;

    const pdfSectorNames = new Set(sectorsData.map((s) => s.sector));

    for (const { sector, positions } of sectorsData) {
      const jobSector = await prisma.jobSector.upsert({
        where: { job_id_sector: { job_id: job.id, sector } },
        update: {},
        create: { job_id: job.id, sector },
      });

      for (const pos of positions) {
        const existing = await prisma.jobPosition.findFirst({
          where: { job_sector_id: jobSector.id, title: pos.title, city: pos.city ?? null },
        });
        if (!existing) {
          await prisma.jobPosition.create({
            data: { job_sector_id: jobSector.id, title: pos.title, city: pos.city ?? null },
          });
        }
      }

      await prisma.jobPosition.deleteMany({
        where: { job_sector_id: jobSector.id, title: DEFAULT_POSITION_TITLE },
      });
    }

    const staleSectors = await prisma.jobSector.findMany({
      where: { job_id: job.id, sector: { notIn: [...pdfSectorNames] } },
      include: { positions: true },
    });
    for (const s of staleSectors) {
      if (s.positions.every((p) => p.title === DEFAULT_POSITION_TITLE)) {
        await prisma.jobSector.delete({ where: { id: s.id } });
      }
    }
  }
}

// Canada pricing fixup (2026-09-02) — production-only jobs, not in the
// JOBS array above, so the main upsert loop never touches them. Gives
// each a 2-stage payment plan (50% Documentation / 50% Visa, no Work
// Permit milestone — reproduces the old two_stage_pricing shape now that
// it's expressed as JobPaymentStage rows, 2026-09-16) and, only where
// missing, backfills service_fee_gbp to match the other two Canada
// programmes' existing £3,100 total — confirmed with the business, not
// fabricated. No-op on dev/staging, which don't have these jobs.
const CANADA_JOB_TITLES = [
  "Canada-Truck Driver-Montreal, Quebec (FRENCH SPEAKERS ONLY)",
  "Canada-Industrial Warehouse & Logistics Support Worker-Quebec City, Quebec (FRENCH SPEAKERS ONLY)",
  "Canada-Oil & Gas Manufacturing Support Worker-Fort McMurray, Alberta",
];
async function applyCanadaPricingFixup() {
  for (const title of CANADA_JOB_TITLES) {
    const job = await prisma.job.findFirst({ where: { title } });
    if (!job) continue;
    await prisma.job.update({
      where: { id: job.id },
      data: { service_fee_gbp: job.service_fee_gbp ?? 3100 },
    });
    await ensurePaymentStages(job.id, TWO_STAGE_PAYMENT_STAGES);
    await syncPricing(job.id, `Canada job ${job.id} ("${title}")`);
  }
}

async function main() {
  for (const t of DOCUMENT_REQUIREMENT_TYPES) {
    await prisma.documentRequirementType.upsert({
      where: { key: t.key },
      update: { label: t.label, is_universal: t.is_universal ?? false, sort_order: t.sort_order },
      create: { key: t.key, label: t.label, is_universal: t.is_universal ?? false, sort_order: t.sort_order },
    });
  }

  for (const [regionName, countries] of Object.entries(REGIONS)) {
    const region = await prisma.region.upsert({
      where: { name: regionName },
      update: {},
      create: { name: regionName },
    });

    for (const countryName of countries) {
      await prisma.country.upsert({
        where: { name: countryName },
        update: { region_id: region.id },
        create: { name: countryName, region_id: region.id },
      });
    }
  }

  for (const sectorName of SECTORS) {
    await prisma.sector.upsert({
      where: { name: sectorName },
      update: {},
      create: { name: sectorName },
    });
  }

  // Per-programme document requirements from the Candidate Information
  // Form's Section 3 checklist ("Required for: X"). Passport copy, passport
  // photos, and CV are required for every programme so aren't listed here —
  // only the country-specific extras are.
  const DOCUMENT_REQUIREMENTS: Record<string, string[]> = {
    Poland: ["all_passport_pages"],
    Belarus: ["national_id", "professional_training_certificate", "e_apostille"],
    Italy: ["cv_europass"],
    Hungary: ["cv_europass"],
    Romania: ["cv_europass"],
    Greece: ["cv_europass"],
    Netherlands: ["cv_europass"],
    Croatia: ["cv_europass"],
    Serbia: ["education_diploma"],
    Bulgaria: ["police_clearance"],
    Slovakia: ["driving_licence", "tachograph_card"],
    Germany: ["zab_recognition_letter"],
  };
  for (const [countryName, documentTypes] of Object.entries(DOCUMENT_REQUIREMENTS)) {
    const country = await prisma.country.findUnique({ where: { name: countryName } });
    if (!country) continue;
    for (const document_type of documentTypes) {
      await prisma.countryDocumentRequirement.upsert({
        where: { country_id_document_type: { country_id: country.id, document_type } },
        update: {},
        create: { country_id: country.id, document_type },
      });
    }
  }

  // These 3 Czech Republic seasonal programmes are gone from the 2026
  // Price List (only the 2-year resident card track survives) — deleted
  // outright rather than left inactive, confirmed zero Applications
  // reference any of them.
  await prisma.job.deleteMany({
    where: {
      title: {
        in: [
          "Czech Republic — 3-Month Seasonal Work Permit",
          "Czech Republic — 6-Month Seasonal Work Permit",
          "Czech Republic — 9-Month Seasonal Work Permit",
        ],
      },
    },
  });

  // Job has no natural unique key beyond its cuid id, so this seed is kept
  // idempotent by title (find-then-create) rather than a Prisma upsert.
  for (const j of JOBS) {
    const existing = await prisma.job.findFirst({ where: { title: j.title } });
    let jobId: string;
    if (existing) {
      const updated = await prisma.job.update({
        where: { id: existing.id },
        data: {
          country: j.country,
          category: j.category,
          tier: j.tier,
          salary_range: j.salary_range,
          job_description: j.job_description,
          requirements: j.requirements,
          visa_type: j.visa_type,
          duration_permit: j.duration_permit,
          processing_time: j.processing_time,
          service_fee_gbp: j.service_fee_gbp,
          visa_success_rates: j.visa_success_rates,
        },
      });
      jobId = updated.id;
    } else {
      const created = await prisma.job.create({
        data: {
          title: j.title,
          country: j.country,
          city: "Nationwide",
          category: j.category,
          tier: j.tier,
          salary_range: j.salary_range,
          job_description: j.job_description,
          requirements: j.requirements,
          status: "active",
          application_fee: 0,
          visa_type: j.visa_type,
          duration_permit: j.duration_permit,
          processing_time: j.processing_time,
          service_fee_gbp: j.service_fee_gbp,
          visa_success_rates: j.visa_success_rates,
        },
      });
      jobId = created.id;
    }
    await ensurePaymentStages(jobId, STANDARD_PAYMENT_STAGES);
    await syncPricing(jobId, `job ${jobId} ("${j.title}")`);
    await backfillDefaultSectorAndPosition(jobId, j.category);
  }

  for (const j of CREDIT_SERVICE_JOBS) {
    const existing = await prisma.job.findFirst({ where: { title: j.title } });
    const data = {
      country: j.country,
      city: j.city,
      category: j.category,
      salary_range: j.salary_range,
      job_description: j.job_description,
      requirements: j.requirements,
      status: "active" as const,
      visa_type: j.visa_type,
      duration_permit: j.duration_permit,
      processing_time: j.processing_time,
      service_fee_gbp: j.service_fee_gbp,
      is_credit_service: true,
      partner_only: true,
    };
    let jobId: string;
    if (existing) {
      const updated = await prisma.job.update({ where: { id: existing.id }, data });
      jobId = updated.id;
    } else {
      const created = await prisma.job.create({ data: { title: j.title, application_fee: 0, ...data } });
      jobId = created.id;
    }
    await ensurePaymentStages(jobId, creditPaymentStages(j.financing_percent, j.installment_count));
    // syncJobMilestonePricing now provisions Stripe pricing for every
    // payment stage regardless of shape (2026-09-16) — the old skip here
    // (JobMilestonePrice/MilestonePaymentType couldn't represent a
    // variable N-installment schedule) no longer applies.
    await syncPricing(jobId, `job ${jobId} ("${j.title}")`);
    await backfillDefaultSectorAndPosition(jobId, j.category);
  }

  await applyPdfPositionCatalog();
  await applyCanadaPricingFixup();

  console.log("Seed complete: regions, countries, sectors, document requirements, and work-permit programmes.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
