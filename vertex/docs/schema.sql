-- CreateEnum
CREATE TYPE "Role" AS ENUM ('candidate', 'regional_recruiter', 'country_supervisor', 'inhouse_supervisor', 'director', 'admin', 'marketing', 'partner', 'hr', 'operations_team', 'operations_director', 'finance');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('submitted', 'under_review', 'interview', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('active', 'closed', 'draft');

-- CreateEnum
CREATE TYPE "CandidateSource" AS ENUM ('self_registered', 'recruiter_sourced', 'partner_sourced');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "CandidateLifecycleStatus" AS ENUM ('identified', 'screened', 'guided_to_apply', 'submitted', 'reported', 'verified', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "ReportCycle" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "ScopeLevel" AS ENUM ('recruiter', 'country', 'inhouse');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('draft', 'submitted', 'verified', 'consolidated', 'returned', 'approved', 'escalated', 'closed');

-- CreateEnum
CREATE TYPE "ExceptionCategory" AS ENUM ('candidate_eligibility_screening', 'documentation_data_integrity', 'crm_system_issue', 'target_capacity_performance', 'compliance_legal_ethical_risk', 'candidate_welfare_conduct', 'operational_timeline_dependency', 'other');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('regional', 'country', 'inhouse', 'management');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('open', 'decided', 'closed');

-- CreateEnum
CREATE TYPE "ExceptionDecision" AS ENUM ('approved', 'modified', 'rejected', 'escalated');

-- CreateEnum
CREATE TYPE "CorrectiveActionStatus" AS ENUM ('open', 'in_progress', 'done');

-- CreateEnum
CREATE TYPE "ScorecardStatus" AS ENUM ('draft', 'finalized');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'active', 'closed');

-- CreateEnum
CREATE TYPE "CampaignMetric" AS ENUM ('verified_candidates', 'conversion_rate');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('email', 'whatsapp', 'phone');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'completed', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "CaseStage" AS ENUM ('registration_document_submission', 'document_preparation_legalization', 'permit_application_submission', 'permit_processing_followup', 'permit_authorization_approved', 'original_documents_dispatch', 'partner_receives_permit', 'visa_interview_preparation', 'visa_interview_decision', 'pre_departure_arrangements', 'departure_arrival_support');

-- CreateEnum
CREATE TYPE "CaseOpsReviewStatus" AS ENUM ('pending', 'confirmed', 'rejected');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('active', 'rejected');

-- CreateEnum
CREATE TYPE "CaseReminderChannel" AS ENUM ('document', 'payment');

-- CreateEnum
CREATE TYPE "MilestonePaymentType" AS ENUM ('documentation', 'permit', 'visa');

-- CreateEnum
CREATE TYPE "CasePaymentStatus" AS ENUM ('pending', 'collected');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'sent', 'signed');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('travel_agency', 'visa_consultancy', 'manpower_supplier', 'other');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('pending', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "MouStatus" AS ENUM ('none', 'sent', 'signed');

-- CreateEnum
CREATE TYPE "PartnerCandidateStatus" AS ENUM ('submitted', 'under_review', 'job_assigned', 'rejected');

-- CreateEnum
CREATE TYPE "EmployerClientStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "google_id" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "role" "Role" NOT NULL DEFAULT 'candidate',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "supervisor_id" TEXT,
    "assigned_country_id" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region_id" TEXT NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sector" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryDocumentRequirement" (
    "id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CountryDocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequirementType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_universal" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRequirementType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "passport_number" TEXT,
    "passport_expiry" TIMESTAMP(3),
    "date_of_birth" TIMESTAMP(3),
    "nationality" TEXT,
    "second_nationality" TEXT,
    "gender" "Gender",
    "current_occupation" TEXT,
    "highest_education" TEXT,
    "home_address" TEXT,
    "whatsapp_number" TEXT,
    "marital_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "full_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "desired_role" TEXT,
    "source" "CandidateSource" NOT NULL DEFAULT 'self_registered',
    "recruiter_id" TEXT,
    "country_name" TEXT,
    "country_id" TEXT,
    "lifecycle_status" "CandidateLifecycleStatus" NOT NULL DEFAULT 'identified',
    "partner_id" TEXT,
    "consent_given" BOOLEAN NOT NULL DEFAULT false,
    "consent_at" TIMESTAMP(3),
    "return_reason" TEXT,
    "screening_result" BOOLEAN,
    "screening_evaluated_at" TIMESTAMP(3),

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "label" TEXT,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateMessage" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "type" "ReportCycle" NOT NULL,
    "scope_level" "ScopeLevel" NOT NULL,
    "country_id" TEXT,
    "submitted_by" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'draft',
    "content" JSONB NOT NULL,
    "return_reason" TEXT,
    "parent_report_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exception" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "category" "ExceptionCategory" NOT NULL,
    "raised_by" TEXT NOT NULL,
    "role_at_raise" "Role" NOT NULL,
    "country_id" TEXT,
    "candidate_id" TEXT,
    "reference_note" TEXT,
    "issue_statement" TEXT NOT NULL,
    "immediate_impact" TEXT NOT NULL,
    "actions_taken" TEXT,
    "root_cause" TEXT,
    "options_considered" TEXT,
    "recommendation" TEXT,
    "decision_required" TEXT NOT NULL,
    "decision_deadline" TIMESTAMP(3) NOT NULL,
    "escalation_level" "EscalationLevel" NOT NULL DEFAULT 'regional',
    "status" "ExceptionStatus" NOT NULL DEFAULT 'open',
    "decision" "ExceptionDecision",
    "decision_notes" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionCorrectiveAction" (
    "id" TEXT NOT NULL,
    "exception_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "owner_id" TEXT,
    "due_date" TIMESTAMP(3),
    "success_measure" TEXT,
    "status" "CorrectiveActionStatus" NOT NULL DEFAULT 'open',
    "evidence" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExceptionCorrectiveAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffScorecard" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "period_month" TIMESTAMP(3) NOT NULL,
    "status" "ScorecardStatus" NOT NULL DEFAULT 'draft',
    "overall_score" DOUBLE PRECISION,
    "performance_category" TEXT,
    "required_action" TEXT,
    "review_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffScorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffScorecardArea" (
    "id" TEXT NOT NULL,
    "scorecard_id" TEXT NOT NULL,
    "area_key" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "rating" INTEGER,
    "evidence" TEXT,

    CONSTRAINT "StaffScorecardArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTarget" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "metric" "CampaignMetric" NOT NULL,
    "country_id" TEXT,
    "region_id" TEXT,
    "target_value" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruiterTarget" (
    "id" TEXT NOT NULL,
    "campaign_target_id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "target_value" DOUBLE PRECISION NOT NULL,
    "set_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruiterTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InhouseCountryAssignment" (
    "id" TEXT NOT NULL,
    "inhouse_supervisor_id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InhouseCountryAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffKpiTarget" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "cycle" "ReportCycle" NOT NULL,
    "kpi_label" TEXT NOT NULL,
    "target_value" DOUBLE PRECISION NOT NULL,
    "set_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffKpiTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruiterNote" (
    "id" TEXT NOT NULL,
    "recruiter_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruiterNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "category" TEXT,
    "salary_range" TEXT,
    "job_description" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'active',
    "application_fee" DOUBLE PRECISION DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "visa_type" TEXT,
    "duration_permit" TEXT,
    "processing_time" TEXT,
    "service_fee_gbp" DOUBLE PRECISION,
    "visa_success_rates" TEXT,
    "tier" TEXT,
    "employer_client_id" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMilestonePrice" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "type" "MilestonePaymentType" NOT NULL,
    "amount_gbp" DOUBLE PRECISION NOT NULL,
    "stripe_product_id" TEXT NOT NULL,
    "stripe_price_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobMilestonePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "job_id" TEXT,
    "application_status" "ApplicationStatus" NOT NULL DEFAULT 'submitted',
    "cover_letter" TEXT,
    "internal_notes" TEXT,
    "interview_date" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "preferred_country_1_id" TEXT,
    "preferred_country_2_id" TEXT,
    "preferred_country_3_id" TEXT,
    "preferred_sector_id" TEXT,
    "earliest_travel_date" TIMESTAMP(3),
    "prior_eu_visa_applied" BOOLEAN,
    "prior_eu_visa_applied_details" TEXT,
    "documents_available" TEXT[],
    "current_location_country_name" TEXT,
    "current_location_country_id" TEXT,
    "holds_schengen_visa" BOOLEAN,
    "holds_schengen_visa_details" TEXT,
    "prior_visa_refusals" BOOLEAN,
    "prior_visa_refusals_details" TEXT,
    "available_for_embassy_appointment" BOOLEAN NOT NULL DEFAULT false,
    "willing_to_start_within_30_days" BOOLEAN NOT NULL DEFAULT false,
    "preferred_contact_channel" "ContactChannel",
    "payment_plan_acknowledged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payment_method" TEXT NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "transaction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "current_stage" "CaseStage" NOT NULL DEFAULT 'registration_document_submission',
    "stage_deadline" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ops_review_status" "CaseOpsReviewStatus" NOT NULL DEFAULT 'pending',
    "ops_reviewed_by_id" TEXT,
    "ops_reviewed_at" TIMESTAMP(3),
    "ops_review_notes" TEXT,
    "status" "CaseStatus" NOT NULL DEFAULT 'active',
    "rejected_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejection_reason" TEXT,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseStageEvent" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "stage" "CaseStage" NOT NULL,
    "owner_id" TEXT,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "CaseStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseReminder" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "channel" "CaseReminderChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "message" TEXT,
    "sent_by" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionFollowUp" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "RetentionFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CasePayment" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "type" "MilestonePaymentType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "receipt_reference" TEXT,
    "receipt_document_id" TEXT,
    "recorded_by" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CasePaymentStatus" NOT NULL DEFAULT 'collected',
    "stripe_payment_link_id" TEXT,
    "stripe_payment_link_url" TEXT,
    "stripe_checkout_session_id" TEXT,
    "sent_to_email" TEXT,

    CONSTRAINT "CasePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationBooking" (
    "id" TEXT NOT NULL,
    "full_name" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'paid',
    "stripe_checkout_session_id" TEXT NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePolicy" (
    "id" TEXT NOT NULL,
    "country_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "documentation_amount" DOUBLE PRECISION,
    "permit_amount" DOUBLE PRECISION,
    "visa_amount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "signed_by_name" TEXT,
    "signed_at" TIMESTAMP(3),
    "signed_ip" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partner_type" "PartnerType" NOT NULL,
    "country_of_operation" TEXT NOT NULL,
    "business_registration_number" TEXT,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "status" "PartnerStatus" NOT NULL DEFAULT 'pending',
    "mou_status" "MouStatus" NOT NULL DEFAULT 'none',
    "mou_signed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerCandidate" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "status" "PartnerCandidateStatus" NOT NULL DEFAULT 'submitted',
    "full_name" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "nationality" TEXT NOT NULL,
    "second_nationality" TEXT,
    "gender" "Gender",
    "passport_number" TEXT NOT NULL,
    "passport_expiry" TIMESTAMP(3) NOT NULL,
    "current_occupation" TEXT,
    "highest_education" TEXT,
    "home_address" TEXT,
    "phone" TEXT,
    "whatsapp_number" TEXT,
    "email" TEXT,
    "marital_status" TEXT,
    "job_id" TEXT NOT NULL,
    "earliest_travel_date" TIMESTAMP(3) NOT NULL,
    "prior_eu_visa_applied" BOOLEAN,
    "prior_eu_visa_applied_details" TEXT,
    "documents_available" TEXT[],
    "payment_plan_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "current_location_country_name" TEXT NOT NULL,
    "current_location_country_id" TEXT,
    "holds_schengen_visa" BOOLEAN,
    "holds_schengen_visa_details" TEXT,
    "prior_visa_refusals" BOOLEAN,
    "prior_visa_refusals_details" TEXT,
    "available_for_embassy_appointment" BOOLEAN NOT NULL DEFAULT false,
    "willing_to_start_within_30_days" BOOLEAN NOT NULL DEFAULT false,
    "preferred_contact_channel" "ContactChannel",
    "reviewed_by" TEXT,
    "rejection_reason" TEXT,
    "bridged_candidate_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "industry" TEXT,
    "contact_name" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "status" "EmployerClientStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployerClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "event" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("event")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_google_id_key" ON "User"("google_id");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_supervisor_id_idx" ON "User"("supervisor_id");

-- CreateIndex
CREATE INDEX "User_assigned_country_id_idx" ON "User"("assigned_country_id");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Country_name_key" ON "Country"("name");

-- CreateIndex
CREATE INDEX "Country_region_id_idx" ON "Country"("region_id");

-- CreateIndex
CREATE UNIQUE INDEX "Sector_name_key" ON "Sector"("name");

-- CreateIndex
CREATE INDEX "CountryDocumentRequirement_country_id_idx" ON "CountryDocumentRequirement"("country_id");

-- CreateIndex
CREATE UNIQUE INDEX "CountryDocumentRequirement_country_id_document_type_key" ON "CountryDocumentRequirement"("country_id", "document_type");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRequirementType_key_key" ON "DocumentRequirementType"("key");

-- CreateIndex
CREATE INDEX "DocumentRequirementType_is_universal_idx" ON "DocumentRequirementType"("is_universal");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_user_id_key" ON "Candidate"("user_id");

-- CreateIndex
CREATE INDEX "Candidate_user_id_idx" ON "Candidate"("user_id");

-- CreateIndex
CREATE INDEX "Candidate_recruiter_id_idx" ON "Candidate"("recruiter_id");

-- CreateIndex
CREATE INDEX "Candidate_country_id_idx" ON "Candidate"("country_id");

-- CreateIndex
CREATE INDEX "Candidate_partner_id_idx" ON "Candidate"("partner_id");

-- CreateIndex
CREATE INDEX "Candidate_lifecycle_status_idx" ON "Candidate"("lifecycle_status");

-- CreateIndex
CREATE INDEX "Candidate_created_at_idx" ON "Candidate"("created_at");

-- CreateIndex
CREATE INDEX "Candidate_recruiter_id_lifecycle_status_idx" ON "Candidate"("recruiter_id", "lifecycle_status");

-- CreateIndex
CREATE INDEX "Candidate_country_id_lifecycle_status_idx" ON "Candidate"("country_id", "lifecycle_status");

-- CreateIndex
CREATE INDEX "Document_candidate_id_idx" ON "Document"("candidate_id");

-- CreateIndex
CREATE INDEX "Document_type_idx" ON "Document"("type");

-- CreateIndex
CREATE INDEX "CandidateMessage_candidate_id_idx" ON "CandidateMessage"("candidate_id");

-- CreateIndex
CREATE INDEX "AuditLog_entity_type_entity_id_idx" ON "AuditLog"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "AuditLog_actor_id_idx" ON "AuditLog"("actor_id");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- CreateIndex
CREATE INDEX "Report_submitted_by_idx" ON "Report"("submitted_by");

-- CreateIndex
CREATE INDEX "Report_country_id_idx" ON "Report"("country_id");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_type_period_start_idx" ON "Report"("type", "period_start");

-- CreateIndex
CREATE INDEX "Report_country_id_type_period_end_idx" ON "Report"("country_id", "type", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "Exception_reference_key" ON "Exception"("reference");

-- CreateIndex
CREATE INDEX "Exception_raised_by_idx" ON "Exception"("raised_by");

-- CreateIndex
CREATE INDEX "Exception_country_id_idx" ON "Exception"("country_id");

-- CreateIndex
CREATE INDEX "Exception_status_idx" ON "Exception"("status");

-- CreateIndex
CREATE INDEX "Exception_escalation_level_idx" ON "Exception"("escalation_level");

-- CreateIndex
CREATE INDEX "ExceptionCorrectiveAction_exception_id_idx" ON "ExceptionCorrectiveAction"("exception_id");

-- CreateIndex
CREATE INDEX "ExceptionCorrectiveAction_owner_id_idx" ON "ExceptionCorrectiveAction"("owner_id");

-- CreateIndex
CREATE INDEX "StaffScorecard_reviewer_id_idx" ON "StaffScorecard"("reviewer_id");

-- CreateIndex
CREATE INDEX "StaffScorecard_staff_id_idx" ON "StaffScorecard"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffScorecard_staff_id_period_month_key" ON "StaffScorecard"("staff_id", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "StaffScorecardArea_scorecard_id_area_key_key" ON "StaffScorecardArea"("scorecard_id", "area_key");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_created_by_idx" ON "Campaign"("created_by");

-- CreateIndex
CREATE INDEX "CampaignTarget_campaign_id_idx" ON "CampaignTarget"("campaign_id");

-- CreateIndex
CREATE INDEX "CampaignTarget_country_id_idx" ON "CampaignTarget"("country_id");

-- CreateIndex
CREATE INDEX "CampaignTarget_region_id_idx" ON "CampaignTarget"("region_id");

-- CreateIndex
CREATE INDEX "RecruiterTarget_recruiter_id_idx" ON "RecruiterTarget"("recruiter_id");

-- CreateIndex
CREATE UNIQUE INDEX "RecruiterTarget_campaign_target_id_recruiter_id_key" ON "RecruiterTarget"("campaign_target_id", "recruiter_id");

-- CreateIndex
CREATE INDEX "InhouseCountryAssignment_inhouse_supervisor_id_idx" ON "InhouseCountryAssignment"("inhouse_supervisor_id");

-- CreateIndex
CREATE INDEX "InhouseCountryAssignment_country_id_idx" ON "InhouseCountryAssignment"("country_id");

-- CreateIndex
CREATE UNIQUE INDEX "InhouseCountryAssignment_inhouse_supervisor_id_country_id_key" ON "InhouseCountryAssignment"("inhouse_supervisor_id", "country_id");

-- CreateIndex
CREATE INDEX "StaffKpiTarget_staff_id_idx" ON "StaffKpiTarget"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffKpiTarget_staff_id_cycle_kpi_label_key" ON "StaffKpiTarget"("staff_id", "cycle", "kpi_label");

-- CreateIndex
CREATE INDEX "RecruiterNote_recruiter_id_idx" ON "RecruiterNote"("recruiter_id");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_country_idx" ON "Job"("country");

-- CreateIndex
CREATE INDEX "Job_employer_client_id_idx" ON "Job"("employer_client_id");

-- CreateIndex
CREATE UNIQUE INDEX "JobMilestonePrice_job_id_type_key" ON "JobMilestonePrice"("job_id", "type");

-- CreateIndex
CREATE INDEX "Application_candidate_id_idx" ON "Application"("candidate_id");

-- CreateIndex
CREATE INDEX "Application_job_id_idx" ON "Application"("job_id");

-- CreateIndex
CREATE INDEX "Application_current_location_country_id_idx" ON "Application"("current_location_country_id");

-- CreateIndex
CREATE INDEX "Application_application_status_idx" ON "Application"("application_status");

-- CreateIndex
CREATE INDEX "Application_submitted_at_idx" ON "Application"("submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transaction_id_key" ON "Payment"("transaction_id");

-- CreateIndex
CREATE INDEX "Payment_user_id_idx" ON "Payment"("user_id");

-- CreateIndex
CREATE INDEX "Payment_job_id_idx" ON "Payment"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "Case_application_id_key" ON "Case"("application_id");

-- CreateIndex
CREATE INDEX "Case_current_stage_idx" ON "Case"("current_stage");

-- CreateIndex
CREATE INDEX "Case_ops_review_status_idx" ON "Case"("ops_review_status");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "CaseStageEvent_case_id_idx" ON "CaseStageEvent"("case_id");

-- CreateIndex
CREATE INDEX "CaseStageEvent_stage_idx" ON "CaseStageEvent"("stage");

-- CreateIndex
CREATE INDEX "CaseReminder_case_id_idx" ON "CaseReminder"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionFollowUp_case_id_key" ON "RetentionFollowUp"("case_id");

-- CreateIndex
CREATE INDEX "CasePayment_case_id_idx" ON "CasePayment"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationBooking_stripe_checkout_session_id_key" ON "ConsultationBooking"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "ConsultationBooking_created_at_idx" ON "ConsultationBooking"("created_at");

-- CreateIndex
CREATE INDEX "FeePolicy_country_id_idx" ON "FeePolicy"("country_id");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_case_id_key" ON "Contract"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_user_id_key" ON "Partner"("user_id");

-- CreateIndex
CREATE INDEX "Partner_status_idx" ON "Partner"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCandidate_bridged_candidate_id_key" ON "PartnerCandidate"("bridged_candidate_id");

-- CreateIndex
CREATE INDEX "PartnerCandidate_partner_id_idx" ON "PartnerCandidate"("partner_id");

-- CreateIndex
CREATE INDEX "PartnerCandidate_status_idx" ON "PartnerCandidate"("status");

-- CreateIndex
CREATE INDEX "PartnerCandidate_job_id_idx" ON "PartnerCandidate"("job_id");

-- CreateIndex
CREATE INDEX "EmployerClient_status_idx" ON "EmployerClient"("status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_assigned_country_id_fkey" FOREIGN KEY ("assigned_country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Country" ADD CONSTRAINT "Country_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountryDocumentRequirement" ADD CONSTRAINT "CountryDocumentRequirement_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountryDocumentRequirement" ADD CONSTRAINT "CountryDocumentRequirement_document_type_fkey" FOREIGN KEY ("document_type") REFERENCES "DocumentRequirementType"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_type_fkey" FOREIGN KEY ("type") REFERENCES "DocumentRequirementType"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMessage" ADD CONSTRAINT "CandidateMessage_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateMessage" ADD CONSTRAINT "CandidateMessage_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_parent_report_id_fkey" FOREIGN KEY ("parent_report_id") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exception" ADD CONSTRAINT "Exception_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCorrectiveAction" ADD CONSTRAINT "ExceptionCorrectiveAction_exception_id_fkey" FOREIGN KEY ("exception_id") REFERENCES "Exception"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionCorrectiveAction" ADD CONSTRAINT "ExceptionCorrectiveAction_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffScorecard" ADD CONSTRAINT "StaffScorecard_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffScorecard" ADD CONSTRAINT "StaffScorecard_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffScorecardArea" ADD CONSTRAINT "StaffScorecardArea_scorecard_id_fkey" FOREIGN KEY ("scorecard_id") REFERENCES "StaffScorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterTarget" ADD CONSTRAINT "RecruiterTarget_campaign_target_id_fkey" FOREIGN KEY ("campaign_target_id") REFERENCES "CampaignTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterTarget" ADD CONSTRAINT "RecruiterTarget_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterTarget" ADD CONSTRAINT "RecruiterTarget_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InhouseCountryAssignment" ADD CONSTRAINT "InhouseCountryAssignment_inhouse_supervisor_id_fkey" FOREIGN KEY ("inhouse_supervisor_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InhouseCountryAssignment" ADD CONSTRAINT "InhouseCountryAssignment_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffKpiTarget" ADD CONSTRAINT "StaffKpiTarget_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffKpiTarget" ADD CONSTRAINT "StaffKpiTarget_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterNote" ADD CONSTRAINT "RecruiterNote_recruiter_id_fkey" FOREIGN KEY ("recruiter_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecruiterNote" ADD CONSTRAINT "RecruiterNote_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_employer_client_id_fkey" FOREIGN KEY ("employer_client_id") REFERENCES "EmployerClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMilestonePrice" ADD CONSTRAINT "JobMilestonePrice_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_preferred_country_1_id_fkey" FOREIGN KEY ("preferred_country_1_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_preferred_country_2_id_fkey" FOREIGN KEY ("preferred_country_2_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_preferred_country_3_id_fkey" FOREIGN KEY ("preferred_country_3_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_preferred_sector_id_fkey" FOREIGN KEY ("preferred_sector_id") REFERENCES "Sector"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_current_location_country_id_fkey" FOREIGN KEY ("current_location_country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_ops_reviewed_by_id_fkey" FOREIGN KEY ("ops_reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStageEvent" ADD CONSTRAINT "CaseStageEvent_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStageEvent" ADD CONSTRAINT "CaseStageEvent_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReminder" ADD CONSTRAINT "CaseReminder_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseReminder" ADD CONSTRAINT "CaseReminder_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionFollowUp" ADD CONSTRAINT "RetentionFollowUp_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePayment" ADD CONSTRAINT "CasePayment_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePayment" ADD CONSTRAINT "CasePayment_receipt_document_id_fkey" FOREIGN KEY ("receipt_document_id") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CasePayment" ADD CONSTRAINT "CasePayment_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePolicy" ADD CONSTRAINT "FeePolicy_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeePolicy" ADD CONSTRAINT "FeePolicy_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCandidate" ADD CONSTRAINT "PartnerCandidate_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCandidate" ADD CONSTRAINT "PartnerCandidate_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCandidate" ADD CONSTRAINT "PartnerCandidate_current_location_country_id_fkey" FOREIGN KEY ("current_location_country_id") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCandidate" ADD CONSTRAINT "PartnerCandidate_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerCandidate" ADD CONSTRAINT "PartnerCandidate_bridged_candidate_id_fkey" FOREIGN KEY ("bridged_candidate_id") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================
-- Audit log immutability (SRS FR-3.6)
-- Must be applied manually after prisma db push — Prisma does
-- not track raw SQL. Re-run after any full schema recreation.
-- Source: prisma/audit-log-immutability.sql
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_auditlog_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog rows are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_auditlog_mutation();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prevent_auditlog_mutation();
