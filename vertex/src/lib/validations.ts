import { z } from "zod";
import { MARITAL_STATUS_VALUES } from "@/lib/maritalStatus";
import { GENDER_VALUES } from "@/lib/gender";

// Treats an empty string as "not provided" before validating an optional
// field's format — otherwise z.string().email().optional() rejects "" from
// an untouched form input, since .optional() only short-circuits undefined.
const optionalEmail = z.preprocess((val) => (val === "" ? undefined : val), z.string().email().optional());

// Same "" → undefined treatment for an optional date-input field. Without
// this, an untouched <input type="date"> sends "" (passes .optional() the
// same way), which then reaches Prisma as a raw string for a DateTime?
// column and crashes ("premature end of input. Expected ISO-8601
// DateTime") instead of just leaving the column alone.
const optionalDateString = z.preprocess((val) => (val === "" ? undefined : val), z.string().optional());

// Same "" → undefined treatment for marital_status's SearchableSelect —
// an untouched dropdown holds "" (its unselected state), not undefined,
// which z.enum(...).optional() rejects outright (2026-08-07: was silently
// failing every submission that left this genuinely optional field blank).
const optionalMaritalStatus = z.preprocess((val) => (val === "" ? undefined : val), z.enum(MARITAL_STATUS_VALUES).optional());

// Same "" → undefined treatment for gender (2026-08-18) — mandatory on
// both application forms, but the underlying column stays nullable (see
// Gender in schema.prisma) so pre-2026-08-18 records don't need a
// backfill. optionalGender is for edit-path schemas (a field that was
// left blank at submission can still be filled in later); requiredGender
// is for the two submission schemas themselves.
const optionalGender = z.preprocess((val) => (val === "" ? undefined : val), z.enum(GENDER_VALUES).optional());
const requiredGender = z.preprocess((val) => (val === "" ? undefined : val), z.enum(GENDER_VALUES, { message: "Gender is required" }));

// Auth
// A candidate account only ever comes into being via the screening
// invite (Candidate Information Form -> screened -> invite -> set
// password) — there's no general-purpose sign-up form anymore, so
// full_name/email/phone/country aren't client-supplied here at all;
// they're read server-side off the Candidate record the invite token
// points at, same data the register page's read-only summary shows.
export const registerSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  invite: z.string().min(1, "An invite link is required to create an account."),
});

// A staff (system-admin-created) or partner (director-provisioned) login
// setting its own password for the first time (2026-07-27) — the User row
// already exists with password_hash null, unlike registerSchema's
// candidate flow where the User doesn't exist yet.
export const completeAccountSetupSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  setup: z.string().min(1, "A setup link is required."),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// Self-service "forgot password" from the login page (2026-08-05). Deliberately
// doesn't reveal whether the email matched a real account — the route
// always returns the same generic message, only actually sending an email
// when there's a real, login-capable (password_hash set) account behind it.
export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  token: z.string().min(1, "A reset link is required."),
});

// Candidate profile — Section 2 of the Candidate Information Form
// ("Candidate Personal Information"), self-service edit path.
export const candidateProfileSchema = z.object({
  passport_number: z.string().optional(),
  date_of_birth: optionalDateString,
  nationality: z.string().optional(),
  second_nationality: z.string().max(100).optional(),
  gender: optionalGender,
  passport_expiry: optionalDateString,
  current_occupation: z.string().max(150).optional(),
  highest_education: z.string().max(150).optional(),
  home_address: z.string().max(500).optional(),
  whatsapp_number: z.string().max(30).optional(),
  marital_status: optionalMaritalStatus,
});

// Jobs
export const createJobSchema = z.object({
  title: z.string().min(3).max(150),
  country: z.string().min(2).max(100),
  city: z.string().min(2).max(100),
  category: z.string().optional(),
  salary_range: z.string().optional(),
  job_description: z.string().min(50, "Job description must be at least 50 characters"),
  requirements: z.string().min(20, "Requirements must be at least 20 characters"),
  status: z.enum(["active", "closed", "draft"]).default("active"),
  employer_client_id: z.string().cuid().optional(),
  // Work-permit programme / pricing fields (Service & Pricing List) — all
  // optional since a plain employer job posting (SRS FR-5.2) has none of
  // these. service_fee_gbp is the total; the 20/40/40 stage split is
  // derived at render time, not stored (see prisma/seed.ts).
  visa_type: z.string().optional(),
  duration_permit: z.string().optional(),
  processing_time: z.string().optional(),
  service_fee_gbp: z.number().positive().optional(),
  visa_success_rates: z.string().optional(),
  // Credit Service Programme pricing model (2026-08-29) — see
  // Job.is_credit_service in schema.prisma for the full rationale.
  // financing_percent/installment_count being required only when
  // is_credit_service is true is enforced by createJobSchema's own
  // .refine() at the POST route's call site, not here — keeping this base
  // schema a plain ZodObject so PUT's existing createJobSchema.partial()
  // usage keeps working (.partial() isn't available after .refine()).
  is_credit_service: z.boolean().default(false),
  financing_percent: z.number().int().min(1).max(100).optional(),
  installment_count: z.number().int().positive().optional(),
  partner_only: z.boolean().default(false),
});

// Programme sectors & positions (2026-09-02) — Marketing attaches one of
// the same 8 canonical sector names already used everywhere else (the
// Job.category values, both forms' SECTOR_ORDER constant) to a specific
// Job, not free text.
const CANONICAL_SECTORS = [
  "Agriculture",
  "Logistics & Warehousing",
  "Manufacturing & Production",
  "Construction & Trades",
  "Hospitality",
  "Healthcare",
  "Transport & Delivery",
  "General / Unskilled",
] as const;

export const createJobSectorSchema = z.object({
  sector: z.enum(CANONICAL_SECTORS),
});

export const createJobPositionSchema = z.object({
  title: z.string().min(2, "Title is required").max(150),
  city: z.string().max(100).optional(),
});

export const updateJobPositionSchema = z.object({
  title: z.string().min(2).max(150).optional(),
  city: z.string().max(100).nullish(),
});

// Applications — the Candidate Information Form: the first thing a
// candidate (or a recruiter on a walk-in lead's behalf) ever fills in, not
// an application to a specific job listing (jobs aren't listed on the
// platform yet — job_id stays optional for when real job matching
// exists). Submitting this is what creates the Candidate record itself
// when there isn't one yet (anonymous self-service, or a recruiter
// entering a brand-new lead). Section 2 (Candidate Personal Information)
// is only actually required in that same case — enforced below via
// superRefine, keyed on candidate_id's presence, rather than a second,
// independently-maintained schema: a submission naming an existing
// candidate_id is always a staff member acting on an already-on-file
// record (see POST /api/applications's branching), so Section 2 is
// necessarily already on file too.
export const submitApplicationSchema = z
  .object({
    // Section 1 — Programme Selection (2026-07-31: a single Job pick,
    // replacing the old 3-country-alternates + sector cluster, for both the
    // public self-submission and the recruiter's own walk-in-lead form).
    job_id: z.string().cuid("Select your opportunity"),
    // Sector -> Opportunity -> Position (2026-09-02) — optional at the
    // schema layer (defensive; an old cached page shouldn't hard-fail if
    // omitted), enforced by the client UI instead. Re-validated server-side
    // against job_id in the route itself (a position must actually belong
    // to the submitted job).
    job_position_id: z.string().cuid().optional(),
    cover_letter: z.string().optional(),
    // Present when staff submits on behalf of an existing candidate record
    // (SRS FR-2.1) — otherwise the authenticated candidate's own profile is
    // used, or (if neither applies) a brand-new Candidate is created.
    candidate_id: z.string().cuid().optional(),
    // Referral Agent attribution (2026-08-29) — captured from ?ref= on
    // /apply, never validated against a real ReferralAgent here (that
    // happens server-side in the route); an invalid/unknown/inactive code
    // silently produces no attribution rather than a validation error.
    referral_code: z.string().max(30).optional(),

    // Section 2 — Candidate Personal Information. Required only when this
    // submission creates/completes a brand-new Candidate — see the
    // superRefine below.
    full_name: z.string().min(2, "Full name is required").max(100).optional(),
    nationality: z.string().min(2, "Nationality is required").max(100).optional(),
    date_of_birth: z.string().optional(),
    passport_number: z.string().optional(),
    passport_expiry: z.string().optional(),
    second_nationality: z.string().max(100).optional(),
    gender: optionalGender,
    current_occupation: z.string().max(150).optional(),
    highest_education: z.string().max(150).optional(),
    home_address: z.string().max(500).optional(),
    phone: z.string().optional(),
    whatsapp_number: z.string().max(30).optional(),
    email: optionalEmail,
    marital_status: optionalMaritalStatus,
    // The form's own "Candidate Declaration" ("I confirm the information
    // provided is true and complete") — the consent capture point for a
    // brand-new candidate; an existing lead may already have consent on
    // file from a recruiter's separate capture.
    consent_given: z.boolean().optional(),

    earliest_travel_date: z.string().min(1, "Earliest possible travel date is required"),
    prior_eu_visa_applied: z.boolean().optional(),
    prior_eu_visa_applied_details: z.string().max(500).optional(),

    // Section 3 — Document Checklist: self-reported "can you provide this?"
    // at submission time, not the documents themselves — those are
    // uploaded later from the candidate's own dashboard once an account
    // exists.
    documents_available: z.array(z.string().min(1).max(60)).default([]),

    // Section 5 — Visa & Travel Readiness. current_location_country_name is
    // a free choice from the full world-country list (lib/worldCountries.ts),
    // not restricted to Vertex's admin-managed Country rows — it's resolved
    // by name server-side (POST /api/applications) for record-keeping, but
    // (2026-07-31) no longer drives recruiter assignment — a public
    // self-submission always routes to HR for review regardless of country.
    current_location_country_name: z.string().min(1, "Select your current location"),
    holds_schengen_visa: z.boolean().optional(),
    holds_schengen_visa_details: z.string().max(500).optional(),
    prior_visa_refusals: z.boolean().optional(),
    prior_visa_refusals_details: z.string().max(500).optional(),
    available_for_embassy_appointment: z.boolean().default(false),
    willing_to_start_within_30_days: z.boolean().default(false),
    preferred_contact_channel: z.enum(["email", "whatsapp", "phone"], {
      message: "Select your preferred contact channel.",
    }),

    // Section 4 — Payment Plan Acknowledgement: must be explicitly ticked to submit.
    payment_plan_acknowledged: z.literal(true, {
      message: "You must acknowledge the payment plan to submit.",
    }),
  })
  .superRefine((data, ctx) => {
    // candidate_id present => staff acting on an already-on-file candidate
    // record — Section 2 was captured whenever that candidate was first
    // created, nothing to require here.
    if (data.candidate_id) return;
    if (!data.full_name || data.full_name.length < 2) {
      ctx.addIssue({ code: "custom", path: ["full_name"], message: "Full name is required" });
    }
    if (!data.nationality || data.nationality.length < 2) {
      ctx.addIssue({ code: "custom", path: ["nationality"], message: "Nationality is required" });
    }
    if (!data.date_of_birth) {
      ctx.addIssue({ code: "custom", path: ["date_of_birth"], message: "Date of birth is required" });
    }
    if (!data.passport_number) {
      ctx.addIssue({ code: "custom", path: ["passport_number"], message: "Passport number is required" });
    }
    if (!data.passport_expiry) {
      ctx.addIssue({ code: "custom", path: ["passport_expiry"], message: "Passport expiry date is required" });
    }
    if (!data.gender) {
      ctx.addIssue({ code: "custom", path: ["gender"], message: "Gender is required" });
    }
    if (!data.phone) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Phone number is required" });
    }
    if (!data.email) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "A valid email is required" });
    }
    if (data.consent_given !== true) {
      ctx.addIssue({ code: "custom", path: ["consent_given"], message: "You must confirm the candidate declaration to submit." });
    }
  });

// application_status itself is a legacy field (retired from any dedicated
// UI, 2026-07-27 — see the Applications-pages removal) — internal_notes
// stays a real, editable field though, now surfaced from CaseDetail
// instead of the old Applications review page, so both are optional here.
export const updateApplicationStatusSchema = z
  .object({
    application_status: z.enum(["submitted", "under_review", "interview", "approved", "rejected"]).optional(),
    internal_notes: z.string().max(2000).optional(),
  })
  .refine((data) => data.application_status !== undefined || data.internal_notes !== undefined, {
    message: "Provide at least one field to update.",
  });

// Regions & Countries (SRS FR-1.4)
export const createRegionSchema = z.object({
  name: z.string().min(2).max(100),
});

export const updateRegionSchema = z.object({
  name: z.string().min(2).max(100),
});

export const createCountrySchema = z.object({
  name: z.string().min(2).max(100),
  region_id: z.string().cuid("Invalid region ID"),
});

export const updateCountrySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  region_id: z.string().cuid("Invalid region ID").optional(),
});

// Sectors ("Preferred Type of Work" on the Candidate Information Form) and
// per-country document requirements (Section 3's "Required for: X" tags) —
// both admin-configurable reference data, same pattern as Region/Country.
export const createSectorSchema = z.object({
  name: z.string().min(2).max(100),
});

export const updateCountryDocumentRequirementsSchema = z.object({
  document_types: z.array(z.string().min(1).max(60)),
});

// Admin-managed document requirement types (replaces the old fixed
// DocumentType enum) — `key` is derived server-side by slugifying the
// label, not supplied directly, so admin only ever thinks in labels.
export const createDocumentRequirementTypeSchema = z.object({
  label: z.string().min(2).max(150),
});

// Staff role/supervisor/country assignment (SRS FR-1.1, FR-1.3, FR-1.4) —
// every role assignable via the admin staff directory. Deliberately wider
// than lib/rbac.ts's STAFF_ROLES (which governs the three-tier candidate
// hierarchy specifically): "marketing" and the separation-of-duties roles
// (hr/operations_team/operations_director/finance, 2026-07-31) are all
// real, assignable staff roles that sit outside that hierarchy entirely.
const STAFF_ROLES = [
  "regional_recruiter",
  "country_supervisor",
  "inhouse_supervisor",
  "director",
  "marketing",
  "hr",
  "operations_team",
  "operations_director",
  "finance",
  "admin",
] as const;
export const updateStaffUserSchema = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  supervisor_id: z.string().cuid().nullable().optional(),
  assigned_country_id: z.string().cuid().nullable().optional(),
  // In-House Supervisor only (2026-07) — replaces assigned_country_id for
  // that one role via InhouseCountryAssignment; an empty array clears every
  // assignment, distinct from `undefined` (leave assignments untouched).
  assigned_country_ids: z.array(z.string().cuid()).optional(),
});

export const createStaffUserSchema = z.object({
  full_name: z.string().min(2).max(100),
  email: z.string().email(),
  role: z.enum(STAFF_ROLES),
  supervisor_id: z.string().cuid().nullable().optional(),
  assigned_country_id: z.string().cuid().nullable().optional(),
  assigned_country_ids: z.array(z.string().cuid()).optional(),
});

// Document verification (SRS FR-2.7, part of the Document model's
// verification_status/verified_by/verified_at added in Phase 1)
export const verifyDocumentSchema = z.object({
  verification_status: z.enum(["verified", "rejected"]),
});

// Progressive candidate detail edits + consent (SRS FR-2.5, FR-2.8) — a
// recruiter fills in a lead's profile over time, not necessarily all at
// registration. Also covers Section 2 of the Candidate Information Form
// for a recruiter-sourced lead who has no account of their own to edit it.
// CRM Comments item 6 (2026-08-10, widened per business follow-up) — a
// partner correcting their own submitted candidate post-submission.
// Originally scoped to basic biodata only ("mostly only biodata" was the
// exact gap reported); now covers everything PartnerCandidateForm collects
// at submission (Sections 3 + 6), so a partner can actually fix any of it
// afterward, not just name/email/nationality/passport.
export const updatePartnerCandidateDetailsSchema = z.object({
  // Programme Information (2026-09-03) — lets a partner correct their own
  // submission's Country/Sector/Position choice, same as staff can via
  // ApplicationEditDetails/PATCH /api/candidates/:id/application. job_id
  // is required whenever job_position_id is set (enforced in the route,
  // not here — the route derives job_id from the position server-side to
  // guard against a mismatched pair, same as POST /api/partner/candidates
  // does at submission time).
  job_id: z.string().cuid().optional(),
  job_position_id: z.string().cuid().nullable().optional(),
  full_name: z.string().min(2).max(150).optional(),
  email: z.string().email().optional(),
  nationality: z.string().min(2).max(100).optional(),
  second_nationality: z.string().max(100).optional(),
  gender: optionalGender,
  passport_number: z.string().min(3).max(50).optional(),
  date_of_birth: z.string().optional(),
  passport_expiry: z.string().optional(),
  current_occupation: z.string().max(150).optional(),
  highest_education: z.string().max(150).optional(),
  home_address: z.string().max(500).optional(),
  whatsapp_number: z.string().max(30).optional(),
  marital_status: optionalMaritalStatus,
  earliest_travel_date: z.string().optional(),
  prior_eu_visa_applied: z.boolean().optional(),
  prior_eu_visa_applied_details: z.string().max(500).optional(),
  current_location_country_name: z.string().min(2).max(100).optional(),
  holds_schengen_visa: z.boolean().optional(),
  holds_schengen_visa_details: z.string().max(500).optional(),
  prior_visa_refusals: z.boolean().optional(),
  prior_visa_refusals_details: z.string().max(500).optional(),
  available_for_embassy_appointment: z.boolean().optional(),
  willing_to_start_within_30_days: z.boolean().optional(),
  preferred_contact_channel: z.enum(["email", "whatsapp"]).optional(),
});

// CRM Comments follow-up (2026-08-10) — staff correcting the Application-
// level fields (programme/travel/visa readiness), which were previously
// frozen forever after submission for every pipeline (self-submitted,
// recruiter-sourced, partner-sourced) — no route touched them at all.
// See PATCH /api/candidates/[id]/application.
export const updateApplicationDetailsSchema = z.object({
  // Programme Information (CRM Comments follow-up, 2026-08-12 — "every
  // section... including Programme Information" must be editable, not
  // just Personal Information and Visa/Travel Readiness).
  job_id: z.string().cuid().optional(),
  // job_position_id (2026-09-03) — added alongside the Sector -> Opportunity
  // -> Position picker; explicit null (not just undefined/omitted) clears a
  // stale position that no longer belongs to a newly-picked job_id, since
  // "field omitted" already means "leave unchanged" for every other field
  // in this schema.
  job_position_id: z.string().cuid().nullable().optional(),
  earliest_travel_date: z.string().optional(),
  prior_eu_visa_applied: z.boolean().optional(),
  prior_eu_visa_applied_details: z.string().max(500).optional(),
  current_location_country_name: z.string().min(2).max(100).optional(),
  holds_schengen_visa: z.boolean().optional(),
  holds_schengen_visa_details: z.string().max(500).optional(),
  prior_visa_refusals: z.boolean().optional(),
  prior_visa_refusals_details: z.string().max(500).optional(),
  available_for_embassy_appointment: z.boolean().optional(),
  willing_to_start_within_30_days: z.boolean().optional(),
  preferred_contact_channel: z.enum(["email", "whatsapp", "phone"]).optional(),
});

export const updateCandidateDetailsSchema = z.object({
  full_name: z.string().min(2).max(100).optional(),
  nationality: z.string().min(2).max(100).optional(),
  date_of_birth: z.string().optional(),
  passport_number: z.string().optional(),
  phone: z.string().optional(),
  email: optionalEmail,
  desired_role: z.string().max(150).optional(),
  consent_given: z.boolean().optional(),
  second_nationality: z.string().max(100).optional(),
  gender: optionalGender,
  passport_expiry: z.string().optional(),
  current_occupation: z.string().max(150).optional(),
  highest_education: z.string().max(150).optional(),
  home_address: z.string().max(500).optional(),
  whatsapp_number: z.string().max(30).optional(),
  marital_status: optionalMaritalStatus,
  // Referral Agent System (2026-08-29) — HR's manual "Clear flag"
  // affordance after reviewing a duplicate-candidate warning, same
  // record-through-the-existing-PATCH pattern as consent_given above.
  referral_duplicate_flag: z.boolean().optional(),
});

// Candidate lifecycle status transitions (SRS FR-2.4, FR-2.5, FR-2.7)
const CANDIDATE_LIFECYCLE_STATUSES = [
  "identified",
  "screened",
  "guided_to_apply",
  "submitted",
  "reported",
  "verified",
  "approved",
  "rejected",
] as const;
export const updateCandidateStatusSchema = z.object({
  lifecycle_status: z.enum(CANDIDATE_LIFECYCLE_STATUSES),
  return_reason: z.string().min(5).max(1000).optional(),
});

// Campaign set-up (SRS FR-3.3) — criteria is free-form (roles, quotas,
// eligibility rules vary by destination market), so it's validated as a
// generic JSON-serializable record rather than a fixed shape.
export const createCampaignSchema = z
  .object({
    name: z.string().min(3).max(150),
    criteria: z.record(z.string(), z.unknown()).default({}),
    start_date: z.string(),
    end_date: z.string(), // a campaign has a bounded timeline (SRS FR-3.3), not an open-ended one
  })
  .refine((data) => new Date(data.end_date) > new Date(data.start_date), {
    message: "End date must be after the start date.",
    path: ["end_date"],
  });

export const updateCampaignSchema = z.object({
  name: z.string().min(3).max(150).optional(),
  criteria: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["draft", "active", "closed"]).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const createCampaignTargetSchema = z
  .object({
    metric: z.enum(["verified_candidates", "conversion_rate"]),
    country_id: z.string().cuid().optional(),
    region_id: z.string().cuid().optional(),
    target_value: z.number().positive(),
  })
  .refine((data) => !(data.country_id && data.region_id), {
    message: "A target can be scoped to a country or a region, not both.",
  });

// A Country Supervisor's personal allocation of a country CampaignTarget
// across their own recruiters — upserted one recruiter at a time.
export const upsertRecruiterTargetSchema = z.object({
  campaign_target_id: z.string().cuid(),
  recruiter_id: z.string().cuid(),
  target_value: z.number().positive(),
});

// A supervisor's personal target for a direct report, keyed to one of
// that recipient's own report KPI-table row labels for a cycle (see
// StaffKpiTarget in schema.prisma) — shared across all 3 supervisory
// relationships (country_supervisor -> recruiter, inhouse_supervisor ->
// country_supervisor, director/admin -> inhouse_supervisor).
export const upsertStaffKpiTargetSchema = z.object({
  staff_id: z.string().cuid(),
  cycle: z.enum(["daily", "weekly", "monthly"]),
  kpi_label: z.string().min(1),
  target_value: z.number().positive(),
});

// A Country Supervisor's one-way note to a specific recruiter (see
// RecruiterNote in schema.prisma) — deliberately just a message string,
// no subject/thread structure.
export const createRecruiterNoteSchema = z.object({
  recruiter_id: z.string().cuid(),
  message: z.string().min(1).max(2000),
});

// Supervisory Reporting Framework §2.1's mandatory sections, expressed as
// one shared, structured content shape reused across every daily/weekly/
// monthly report regardless of role — the specific KPI/row *names* per
// role and cycle are a frontend concern (src/lib/reportTemplates.ts), not
// a schema one, since the underlying arrays are structurally identical
// (a labeled row with a handful of optional values) whether it's a
// recruiter's daily KPI table or an in-house supervisor's monthly one.
// Every array defaults to empty since not every section applies to every
// cycle (e.g. a daily report has no competency self-rating table).
const reportKpiRowSchema = z.object({
  label: z.string().min(1),
  target: z.number().optional(),
  actual: z.number().optional(),
  comment: z.string().max(1000).optional(),
});

// Weekly funnel-stage table (§3.2/§4.2) — candidate-lifecycle stage counts
// moving through opening/added/moved-forward/closed/closing.
const reportPipelineRowSchema = z.object({
  stage: z.string().min(1),
  opening: z.number().optional(),
  added: z.number().optional(),
  moved_forward: z.number().optional(),
  closed_rejected: z.number().optional(),
  closing: z.number().optional(),
  target: z.number().optional(),
});

// Daily candidate-level activity table (§3.1) — one row per candidate touched that day.
const reportActivityRowSchema = z.object({
  candidate_ref: z.string().min(1),
  role: z.string().max(150).optional(),
  current_status: z.string().max(100).optional(),
  action_completed: z.string().max(500).optional(),
  next_action: z.string().max(500).optional(),
});

// Issue/Blocker (daily) or Challenge/Risk (weekly) table — same shape,
// different column labels rendered per cycle.
const reportIssueRowSchema = z.object({
  label: z.string().min(1),
  detail: z.string().max(1000).optional(),
  action: z.string().max(1000).optional(),
  owner: z.string().max(150).optional(),
  due_date: z.string().optional(),
  status: z.string().max(100).optional(),
  escalation: z.boolean().optional(),
});

// Next-week/next-month priority/objective table.
const reportPriorityRowSchema = z.object({
  label: z.string().min(1),
  planned_activity: z.string().max(500).optional(),
  target_measure: z.string().max(300).optional(),
  support_required: z.string().max(500).optional(),
  owner: z.string().max(150).optional(),
  due_date: z.string().optional(),
});

// Weekly "Top Achievement" table.
const reportAchievementRowSchema = z.object({
  label: z.string().min(1),
  evidence: z.string().max(1000).optional(),
  business_impact: z.string().max(1000).optional(),
});

// Monthly Competency/Control Area self + supervisor rating table (§3.3) —
// this is the recruiter's own self-assessment inside their monthly
// report, distinct from the separate Supervisory Performance Scorecard
// (StaffScorecard model), which is the supervisor's independent review.
const reportCompetencyRowSchema = z.object({
  area: z.string().min(1),
  self_rating: z.number().min(1).max(5).optional(),
  evidence: z.string().max(1000).optional(),
  supervisor_rating: z.number().min(1).max(5).optional(),
});

export const reportContentSchema = z.object({
  campaign_or_role: z.string().max(200).optional(),
  crm_reference: z.string().max(200).optional(),
  executive_summary: z.string().max(3000).optional(),
  overall_status: z.enum(["green", "amber", "red", "grey"]).optional(),
  kpis: z.array(reportKpiRowSchema).default([]),
  pipeline: z.array(reportPipelineRowSchema).default([]),
  activity: z.array(reportActivityRowSchema).default([]),
  issues: z.array(reportIssueRowSchema).default([]),
  achievements: z.array(reportAchievementRowSchema).default([]),
  priorities: z.array(reportPriorityRowSchema).default([]),
  competencies: z.array(reportCompetencyRowSchema).default([]),
  key_achievement: z.string().max(500).optional(),
  next_priority: z.string().max(500).optional(),
  // The framework's "Reporter Certification: I confirm..." + signature —
  // simplified to a plain confirmation flag on an authenticated submit;
  // the Report row's own submitted_by/created_at is the timestamp/identity
  // record, no separate typed attestation.
  certified: z.literal(true, { message: "You must certify this report before submitting." }),
});

// Reporting cycle (SRS FR-3.4; Supervisory Reporting Framework §3-§5) — a
// recruiter submits daily/weekly/monthly reports; a country_supervisor
// consolidates verified recruiter reports (child_report_ids) into a
// country report; an inhouse_supervisor consolidates their verified
// country report into a portfolio report submitted to Management/Director.
export const submitReportSchema = z
  .object({
    type: z.enum(["daily", "weekly", "monthly"]),
    period_start: z.string(),
    period_end: z.string(),
    content: reportContentSchema,
    child_report_ids: z.array(z.string().cuid()).optional(),
  })
  // A daily report covers a single day (period_start === period_end, one
  // date picker in the UI); weekly/monthly need a genuine range.
  .refine((data) => data.type === "daily" || new Date(data.period_end) > new Date(data.period_start), {
    message: "Period end must be after the period start.",
    path: ["period_end"],
  })
  .refine((data) => new Date(data.period_end) <= new Date(), {
    message: "A report can't cover a period that hasn't happened yet.",
    path: ["period_end"],
  })
  // A weekly report is always a fixed Monday-Sunday, 7-day window — not a
  // free-form range. Without this, two recruiters covering "the same
  // week" could submit different day-ranges (Mon-Fri vs Mon-Sat) that
  // never exactly match, silently breaking the consolidation logic, which
  // groups reports by exact period_start/period_end equality. Applies at
  // every tier (recruiter, country, in-house), since the same matching
  // logic is used at each level.
  .refine((data) => data.type !== "weekly" || new Date(data.period_start).getUTCDay() === 1, {
    message: "A weekly report must start on a Monday.",
    path: ["period_start"],
  })
  .refine(
    (data) => {
      if (data.type !== "weekly") return true;
      const diffDays = (new Date(data.period_end).getTime() - new Date(data.period_start).getTime()) / (24 * 60 * 60 * 1000);
      return diffDays === 6;
    },
    { message: "A weekly report must cover exactly 7 days (Monday through Sunday).", path: ["period_end"] }
  );

export const returnReportSchema = z.object({
  return_reason: z.string().min(5).max(1000),
});

// Supervisory Reporting Framework §6 — a standalone exception/escalation
// report, raised ad hoc at any time by any tier, independent of the
// daily/weekly/monthly cadence above.
export const raiseExceptionSchema = z.object({
  category: z.enum([
    "candidate_eligibility_screening",
    "documentation_data_integrity",
    "crm_system_issue",
    "target_capacity_performance",
    "compliance_legal_ethical_risk",
    "candidate_welfare_conduct",
    "operational_timeline_dependency",
    "other",
  ]),
  candidate_id: z.string().cuid().optional(),
  reference_note: z.string().max(300).optional(),
  issue_statement: z.string().min(10, "Describe what happened.").max(2000),
  immediate_impact: z.string().min(5, "Describe the immediate impact.").max(2000),
  actions_taken: z.string().max(2000).optional(),
  root_cause: z.string().max(2000).optional(),
  options_considered: z.string().max(2000).optional(),
  recommendation: z.string().max(2000).optional(),
  decision_required: z.string().min(5, "State the decision required.").max(1000),
  decision_deadline: z.string().min(1, "A decision deadline is required."),
  corrective_actions: z
    .array(
      z.object({
        action: z.string().min(1).max(500),
        owner_id: z.string().cuid().optional(),
        due_date: z.string().optional(),
        success_measure: z.string().max(500).optional(),
      })
    )
    .default([]),
});

// Escalate (move up one tier) or decide (close out) an existing exception.
export const escalateExceptionSchema = z.object({
  action: z.literal("escalate"),
});

export const decideExceptionSchema = z.object({
  action: z.literal("decide"),
  decision: z.enum(["approved", "modified", "rejected", "escalated"]),
  decision_notes: z.string().max(2000).optional(),
});

export const updateExceptionSchema = z.discriminatedUnion("action", [escalateExceptionSchema, decideExceptionSchema]);

// Supervisory Reporting Framework §7 — a supervisor's monthly, evidence-
// based review of one direct report's own performance (never self-
// submitted). Weights are fixed by the framework's own table (20/20/15/
// 15/15/10/5) and enforced server-side, not trusted from the client.
export const SCORECARD_AREAS = [
  { key: "target_achievement", weight: 0.2, label: "Target Achievement / Productivity" },
  { key: "quality_accuracy", weight: 0.2, label: "Quality and Accuracy" },
  { key: "reporting_timeliness", weight: 0.15, label: "Reporting Timeliness" },
  { key: "compliance_data_discipline", weight: 0.15, label: "Compliance and Data Discipline" },
  { key: "supervision_collaboration", weight: 0.15, label: "Supervision / Collaboration" },
  { key: "issue_resolution_escalation", weight: 0.1, label: "Issue Resolution / Escalation" },
  { key: "professional_conduct", weight: 0.05, label: "Professional Conduct" },
] as const;

const scorecardAreaKeys = SCORECARD_AREAS.map((a) => a.key) as [string, ...string[]];

export const upsertStaffScorecardSchema = z.object({
  staff_id: z.string().cuid(),
  period_month: z.string().min(1),
  areas: z
    .array(
      z.object({
        area_key: z.enum(scorecardAreaKeys),
        rating: z.number().min(1).max(5).optional(),
        evidence: z.string().max(1000).optional(),
      })
    )
    .max(SCORECARD_AREAS.length),
});

export const finalizeStaffScorecardSchema = z.object({
  review_date: z.string().optional(),
});

// Contact form
export const contactFormSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  subject: z.string().min(5).max(200),
  message: z.string().min(10).max(2000),
});

// ── Phase 4: Extended Mobility Lifecycle ────────────────────────────────

const CASE_STAGES = [
  "registration_document_submission",
  "document_preparation_legalization",
  "permit_application_submission",
  "permit_processing_followup",
  "permit_authorization_approved",
  "original_documents_dispatch",
  "partner_receives_permit",
  "visa_interview_preparation",
  "visa_interview_decision",
  "pre_departure_arrangements",
  "departure_arrival_support",
] as const;

export const advanceCaseStageSchema = z.object({
  stage: z.enum(CASE_STAGES),
  notes: z.string().max(2000).optional(),
  // Staff-entered expected completion of the stage being entered (FR-4.4)
  // — never system-computed from an assumed SLA, since none is specified.
  stage_deadline: z.string().optional(),
});

// CRM Comments item 3 (2026-08-10) — Operations/Director's documentation
// confirmation gate. notes required on reject, matching the reason-
// required pattern already used for Reject elsewhere (HrCandidateStatusControls,
// PartnerSubmissionDetail).
export const caseOpsReviewSchema = z
  .object({
    decision: z.enum(["confirmed", "rejected"]),
    notes: z.string().max(2000).optional(),
  })
  .refine((data) => data.decision !== "rejected" || !!data.notes?.trim(), {
    message: "A note is required when rejecting.",
    path: ["notes"],
  });

// A real case-level rejection (2026-08-16) — see PATCH /api/cases/[id]/reject.
export const caseRejectSchema = z.object({
  reason: z.string().min(1, "A reason is required.").max(2000),
});

export const createContractSchema = z.object({
  content: z.string().min(20).max(20000),
});

export const signContractSchema = z.object({
  signed_by_name: z.string().min(2).max(200),
});

// The 3-stage plan from the Candidate Information Form: documentation
// (Stage 1 · 25%, on engagement), permit (Stage 2 · 25%, after the work
// permit is issued), visa (Stage 3 · 50%, after the visa is granted).
export const recordCasePaymentSchema = z.object({
  type: z.enum(["documentation", "permit", "visa", "upfront"]),
  amount: z.number().positive(),
  currency: z.string().length(3).default("USD"),
  receipt_reference: z.string().max(200).optional(),
  // An uploaded receipt file (2026-07-31 — Stripe restricted to
  // self-applicants; the standard path for a partner/recruiter-sourced
  // payment, whose real Stripe checkout never happens on this platform).
  // Additive to receipt_reference, not a replacement for it.
  receipt_document_id: z.string().cuid().optional(),
});

// A director/admin generating a Stripe Payment Link for one of a case's
// 3 milestones, sent to whichever party is financially responsible.
export const generateCasePaymentLinkSchema = z.object({
  type: z.enum(["documentation", "permit", "visa"]),
  recipient: z.enum(["candidate", "partner"]),
});

// Finance emailing a case milestone invoice that isn't going through
// Stripe (2026-08-04) — partner/recruiter-sourced cases always pay this
// way, and this also covers a self-applicant case when Stripe itself
// isn't available. The invoice itself is a real file Finance already
// generated elsewhere (their bank/Wise, Stripe Invoicing, etc.) and
// uploaded via the existing /api/upload pipeline first — this just
// records the amount/recipient and attaches that upload to the email.
export const sendCaseInvoiceSchema = z.object({
  type: z.enum(["documentation", "permit", "visa", "upfront"]),
  amount: z.number().positive(),
  recipient: z.enum(["candidate", "partner"]),
  invoice_document_id: z.string().cuid("Attach the invoice file first."),
  invoice_reference: z.string().max(200).optional(),
});

// Finance manually confirming a pending (invoice-emailed) payment was
// received (2026-08-04) — a real uploaded receipt is required, not
// optional, since there's no webhook backing this confirmation the way
// there is for a Stripe payment link; the file is the actual proof.
export const markCasePaymentPaidSchema = z.object({
  receipt_document_id: z.string().cuid("A receipt file is required to mark this payment as paid."),
});

// Finance replacing or removing a payment's already-attached invoice/
// receipt file (2026-08-16) — previously a one-way attach with no way to
// fix a wrong upload afterward. `null` clears the attachment; a cuid
// replaces it with a freshly-uploaded file (uploaded first via the
// existing /api/upload pipeline, same as every other attachment here).
export const updateCasePaymentReceiptSchema = z.object({
  receipt_document_id: z.string().cuid("Invalid document id.").nullable(),
});

// Operations sending a manual reminder email for a delayed document or
// payment (2026-07-31, per the Operational Workflow SOP).
export const sendCaseReminderSchema = z.object({
  channel: z.enum(["document", "payment"]),
  recipient: z.enum(["candidate", "partner"]),
  message: z.string().max(1000).optional(),
});

export const updateFeePolicySchema = z.object({
  country_id: z.string().cuid().nullish(),
  enabled: z.boolean(),
  documentation_amount: z.number().positive().nullish(),
  permit_amount: z.number().positive().nullish(),
  visa_amount: z.number().positive().nullish(),
  currency: z.string().length(3).default("USD"),
});

export const completeRetentionFollowUpSchema = z.object({
  notes: z.string().max(2000).optional(),
});

// Phase 5: Partner CRM (SRS FR-5.1) — travel agencies, visa consultancies,
// manpower suppliers. Partners get their own admin-provisioned login and
// submit candidates themselves (see provisionPartnerAccountSchema and
// submitPartnerCandidateSchema below).
const PARTNER_TYPES = ["travel_agency", "visa_consultancy", "manpower_supplier", "other"] as const;
export const createPartnerSchema = z.object({
  name: z.string().min(2, "Name is required").max(150),
  partner_type: z.enum(PARTNER_TYPES),
  country_of_operation: z.string().min(2, "Country of operation is required").max(100),
  business_registration_number: z.string().max(100).optional(),
  contact_name: z.string().min(2, "Contact name is required").max(150),
  contact_email: z.string().email("A valid contact email is required"),
  contact_phone: z.string().min(3, "Contact phone is required").max(30),
  notes: z.string().max(2000).optional(),
});

export const updatePartnerSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  partner_type: z.enum(PARTNER_TYPES).optional(),
  country_of_operation: z.string().min(2).max(100).optional(),
  business_registration_number: z.string().max(100).nullish(),
  contact_name: z.string().min(2).max(150).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().min(3).max(30).optional(),
  status: z.enum(["pending", "active", "suspended"]).optional(),
  mou_status: z.enum(["none", "sent", "signed"]).optional(),
  notes: z.string().max(2000).nullish(),
});

// Admin provisions a Partner's own login (SRS FR-5.1) — email defaults to
// the Partner's contact_email but can be overridden (e.g. a different
// person handles the account than the primary business contact).
export const provisionPartnerAccountSchema = z.object({
  email: z.string().email().optional(),
});

// A partner submitting a candidate through its own portal (SRS FR-5.1) —
// the Agency Application Form's Sections 2-6 (Section 1, Agency
// Information, is already on file on the Partner record itself, not
// per-submission). Every field here is for a brand-new candidate — unlike
// submitApplicationSchema, there's no "existing candidate resubmitting"
// case, so personal-info fields are required, not conditional.
export const submitPartnerCandidateSchema = z.object({
  // Staff-only (CRM Comments item 10, 2026-08-10) — which partner this
  // on-behalf-of submission belongs to. Ignored/unused when the caller is
  // a partner themselves; their own Partner.id is always derived from
  // their login, never client-supplied.
  partner_id: z.string().cuid().optional(),
  full_name: z.string().min(2, "Full name is required").max(100),
  nationality: z.string().min(2, "Nationality is required").max(100),
  date_of_birth: z.string().min(1, "Date of birth is required"),
  gender: requiredGender,
  passport_number: z.string().min(1, "Passport number is required"),
  passport_expiry: z.string().min(1, "Passport expiry date is required"),
  // No phone, email, or WhatsApp field on this form (2026-08-04, extended
  // 2026-08-15) — partners want to keep the candidate's direct contact
  // details private from Vertex; the partner is the sole point of contact
  // for a candidate they source, so Vertex has no need to reach the
  // candidate directly at all. Both stay optional in the schema (rather
  // than removed outright) since existing pre-2026-08-15 submissions
  // still have real data in them.
  email: z.string().email("A valid email is required").optional(),
  second_nationality: z.string().max(100).optional(),
  current_occupation: z.string().max(150).optional(),
  highest_education: z.string().max(150).optional(),
  home_address: z.string().max(500).optional(),
  whatsapp_number: z.string().max(30).optional(),
  marital_status: optionalMaritalStatus,

  job_id: z.string().cuid("Select the candidate's opportunity"),
  job_position_id: z.string().cuid().optional(),
  earliest_travel_date: z.string().min(1, "Earliest possible travel date is required"),
  prior_eu_visa_applied: z.boolean().optional(),
  prior_eu_visa_applied_details: z.string().max(500).optional(),

  documents_available: z.array(z.string().min(1).max(60)).default([]),

  payment_plan_acknowledged: z.literal(true, {
    message: "You must acknowledge the payment plan to submit.",
  }),

  current_location_country_name: z.string().min(2, "Select the candidate's current location"),
  holds_schengen_visa: z.boolean().optional(),
  holds_schengen_visa_details: z.string().max(500).optional(),
  prior_visa_refusals: z.boolean().optional(),
  prior_visa_refusals_details: z.string().max(500).optional(),
  available_for_embassy_appointment: z.boolean().default(false),
  willing_to_start_within_30_days: z.boolean().default(false),
  // No contact-channel picker on this form (2026-08-15) — with no phone,
  // email, or WhatsApp collected, there's no candidate-facing channel for
  // Vertex to pick between; the partner is contacted instead, always.
  preferred_contact_channel: z.enum(["email", "whatsapp"]).optional(),
});

// Phase 5: Employer/Client CRM (SRS FR-5.2) — the employer a vacancy is
// actually for, distinct from Partner (which sources candidates, not jobs).
export const createEmployerClientSchema = z.object({
  name: z.string().min(2, "Name is required").max(150),
  country: z.string().min(2, "Country is required").max(100),
  industry: z.string().max(100).optional(),
  contact_name: z.string().min(2, "Contact name is required").max(150),
  contact_email: z.string().email("A valid contact email is required"),
  contact_phone: z.string().min(3, "Contact phone is required").max(30),
  notes: z.string().max(2000).optional(),
});

export const updateEmployerClientSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  country: z.string().min(2).max(100).optional(),
  industry: z.string().max(100).nullish(),
  contact_name: z.string().min(2).max(150).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().min(3).max(30).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  notes: z.string().max(2000).nullish(),
});

// Public contact form (/contact) — always emails PUBLIC_FORMS_NOTIFY_EMAIL
// regardless of the intake_mode setting; there's no CRM-side equivalent of
// a general enquiry to gate.
export const contactMessageSchema = z.object({
  name: z.string().min(2, "Name is required").max(150),
  email: z.string().email("A valid email is required"),
  subject: z.string().min(2, "Subject is required").max(200),
  message: z.string().min(10, "Message is required").max(5000),
  // CRM Comments item 7 (2026-08-10) — a partner-agency inquiry can
  // include its registration/licence number; optional since most contact
  // messages aren't from partners at all.
  registration_number: z.string().max(100).optional(),
});

// Public self-registration for the Referral Agent System (2026-08-29) —
// mirrors createPartnerSchema's shape/style, but every field beyond the
// core identity ones is optional (the brief's own promotion/network
// fields are useful context for approval, not hard requirements to apply).
export const registerReferralAgentSchema = z.object({
  full_name: z.string().min(2, "Full name is required").max(150),
  email: z.string().email("A valid email is required"),
  phone: z.string().min(3, "Phone number is required").max(30),
  whatsapp_number: z.string().max(30).optional(),
  country: z.string().min(2, "Country is required").max(100),
  city: z.string().max(100).optional(),
  date_of_birth: z.string().optional(),
  nationality: z.string().max(100).optional(),
  preferred_contact_channel: z.enum(["email", "whatsapp", "phone"]).optional(),
  previous_experience: z.string().max(2000).optional(),
  current_occupation: z.string().max(150).optional(),
  network_size: z.coerce.number().int().min(0).optional(),
  social_media_profiles: z.string().max(1000).optional(),
  promotion_plan: z.string().max(2000).optional(),
  payment_details: z.string().max(500).optional(),
});

// Director/Admin provisions a Referral Agent's own login on approval — same
// email-override shape as provisionPartnerAccountSchema.
export const approveReferralAgentSchema = z.object({
  email: z.string().email().optional(),
});

// Covers reject (pending_approval -> rejected), suspend (active ->
// suspended), and reactivate (suspended -> active) in one route — reason
// is required for reject/suspend (enforced in the route, since it depends
// on which status is targeted) and ignored for reactivate.
export const updateReferralAgentStatusSchema = z.object({
  status: z.enum(["rejected", "suspended", "active"]),
  reason: z.string().max(2000).optional(),
});

// Commission-rule grid (2026-08-29) — one row per (country, milestone),
// amount explicitly allowed to be 0 (some milestones legitimately pay
// nothing, per the business — z.number().min(0) allows this, it's not
// treated as "unset").
export const upsertReferralCommissionRuleSchema = z.object({
  country_id: z.string().cuid(),
  milestone: z.enum(["registered", "qualified", "application_submitted", "work_permit_approved", "visa_approved", "deployed"]),
  amount: z.coerce.number().min(0),
  currency: z.string().min(1).max(10).default("USD"),
});

// Commission payout confirmation (2026-08-29) — receipt is optional here,
// unlike markCasePaymentPaidSchema's required one: the underlying
// milestone event (the ReferralCommission row itself) is already the
// record of what happened, so a receipt is a nice-to-have, not the only
// proof.
export const markReferralCommissionPaidSchema = z.object({
  payment_reference: z.string().max(200).optional(),
  payment_method: z.string().max(100).optional(),
});

export const createReferralAgentTargetSchema = z.object({
  period_start: z.string().min(1, "Start date is required"),
  period_end: z.string().min(1, "End date is required"),
  target_referrals: z.coerce.number().int().min(0),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type SubmitApplicationInput = z.infer<typeof submitApplicationSchema>;
