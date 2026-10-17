import { Prisma, type Role } from "@prisma/client";

// Schema-driven backup/export catalog (2026-10-05). Everything about which
// tables, columns, relationships and enum "status" values exist is read from
// Prisma's own runtime DMMF, so a new model/field/relation added to
// schema.prisma shows up in the export builder automatically — the only
// hand-maintained parts are below: which category a table is listed under,
// which roles may export it, and which columns are never exported.
//
// Row-level scope: every role with backup access already has unscoped,
// platform-wide read access to the tables granted to it here (the old
// candidates-csv/partners-csv backup was unscoped for all of them too), so
// table-level allowlisting + ROLE_ROW_FILTERS is the whole access model.

export type DmmfModel = (typeof Prisma.dmmf.datamodel.models)[number];
export type DmmfField = DmmfModel["fields"][number];

export const BACKUP_ROLES: Role[] = [
  "admin",
  "director",
  "operations_team",
  "operations_director",
  "hr",
  "finance",
];

export const CATEGORIES: { key: string; label: string; models: string[] }[] = [
  { key: "candidates", label: "Candidates & Applications", models: ["Candidate", "Application", "CandidateMessage"] },
  { key: "partners", label: "Partners & Partner Submissions", models: ["Partner", "PartnerCandidate"] },
  { key: "cases", label: "Cases", models: ["Case", "CaseStageEvent", "Contract", "CaseReminder", "RetentionFollowUp"] },
  { key: "payments", label: "Payments & Finance", models: ["CasePayment", "Payment", "ConsultationBooking", "FeePolicy"] },
  { key: "documents", label: "Documents", models: ["Document", "DocumentRequirementType", "CountryDocumentRequirement"] },
  { key: "jobs", label: "Jobs & Programmes", models: ["Job", "JobSector", "JobPosition", "JobPaymentStage", "EmployerClient"] },
  {
    key: "users",
    label: "Users & Staff",
    models: [
      "User",
      "InhouseCountryAssignment",
      "StaffKpiTarget",
      "StaffScorecard",
      "StaffScorecardArea",
      "RecruiterTarget",
      "RecruiterNote",
    ],
  },
  { key: "reporting", label: "Reporting & Governance", models: ["Report", "Exception", "ExceptionCorrectiveAction", "AuditLog"] },
  { key: "campaigns", label: "Campaigns", models: ["Campaign", "CampaignTarget"] },
  {
    key: "referrals",
    label: "Referral Agents",
    models: ["ReferralAgent", "ReferralCommission", "ReferralCommissionRule", "ReferralAgentTarget"],
  },
  { key: "reference", label: "Reference Data", models: ["Region", "Country", "Sector"] },
  { key: "system", label: "System", models: ["SystemSetting", "KnowledgeArticle", "EmailTemplate"] },
];

// Friendlier names for the tables staff actually talk about; anything not
// listed falls back to splitting the model name ("CaseStageEvent" ->
// "Case Stage Event").
const MODEL_LABELS: Record<string, string> = {
  PartnerCandidate: "Partner Submissions",
  User: "Users",
  CasePayment: "Case Payments",
  Payment: "Application Fee Payments",
  CandidateMessage: "Candidate Messages",
  Case: "Cases",
  Candidate: "Candidates",
  Application: "Applications",
  Document: "Documents",
  Partner: "Partners",
  Job: "Jobs / Opportunities",
  AuditLog: "Audit Log",
};

const ALL_MODELS = CATEGORIES.flatMap((c) => c.models);

// Tables kept out of every category on purpose, so no role can export them
// (canExportModel refuses them, including through a relation).
export const NEVER_EXPORTED: Record<string, string> = {
  RefreshToken: "session credentials (refresh-token hashes, G19); not business data",
};

const CORE_OPERATIONAL = [
  "Candidate",
  "Application",
  "CandidateMessage",
  "Partner",
  "PartnerCandidate",
  "Case",
  "CaseStageEvent",
  "Contract",
  "CaseReminder",
  "RetentionFollowUp",
  "CasePayment",
  "Document",
  "DocumentRequirementType",
  "CountryDocumentRequirement",
  "Job",
  "JobSector",
  "JobPosition",
  "JobPaymentStage",
  "User",
  "Region",
  "Country",
  "Sector",
];

// Mirrors each role's existing API access: referral data is
// REFERRAL_AGENT_MANAGER_ROLES-only, consultations are OPERATIONS+FINANCE,
// EmployerClient/reporting/scorecards/system tables stay director/admin.
const ROLE_MODELS: Record<string, string[]> = {
  admin: ALL_MODELS,
  director: ALL_MODELS,
  operations_team: [...CORE_OPERATIONAL, "ConsultationBooking", "InhouseCountryAssignment"],
  operations_director: [...CORE_OPERATIONAL, "ConsultationBooking", "InhouseCountryAssignment"],
  hr: CORE_OPERATIONAL,
  finance: [...CORE_OPERATIONAL, "Payment", "ConsultationBooking", "FeePolicy"],
};

// Never exported, for any role — credential material, not business data.
const EXCLUDED_FIELDS: Record<string, string[]> = {
  User: ["password_hash", "google_id"],
};

// Rows a role must not see even inside a table it may export — partner
// drafts are never visible to HR/Operations/Finance queues (see
// PartnerCandidateStatus.draft), so a backup shouldn't surface them either.
const ROLE_ROW_FILTERS: Partial<Record<Role, Record<string, Record<string, unknown>>>> = {
  hr: { PartnerCandidate: { status: { not: "draft" } } },
  operations_team: { PartnerCandidate: { status: { not: "draft" } } },
  operations_director: { PartnerCandidate: { status: { not: "draft" } } },
  finance: { PartnerCandidate: { status: { not: "draft" } } },
};

// A human-readable label for the record picker — the first non-empty value
// among these paths. Tables with no name-like column of their own resolve
// one through a to-one relation path. A Candidate's name lives on its
// linked User once an account exists (Candidate.full_name is only the
// pre-registration identity), hence the two-path candidate entries.
const LABEL_FIELD_CANDIDATES = ["full_name", "name", "title", "reference", "label", "email", "key", "event", "contact_name"];
const CANDIDATE_NAME = (prefix: string[]) => [
  [...prefix, "user", "full_name"],
  [...prefix, "full_name"],
];
const LABEL_PATHS: Record<string, string[][]> = {
  Candidate: [...CANDIDATE_NAME([]), ["email"]],
  Case: CANDIDATE_NAME(["application", "candidate"]),
  Application: CANDIDATE_NAME(["candidate"]),
  Document: CANDIDATE_NAME(["candidate"]),
  CandidateMessage: CANDIDATE_NAME(["candidate"]),
  CasePayment: CANDIDATE_NAME(["case", "application", "candidate"]),
  Contract: CANDIDATE_NAME(["case", "application", "candidate"]),
  CaseStageEvent: CANDIDATE_NAME(["case", "application", "candidate"]),
};

// Preferred "date range" column per table, in priority order; the first
// DateTime column that exists wins, and the UI lets the user pick any other.
const DATE_FIELD_PRIORITY = [
  "created_at",
  "submitted_at",
  "recorded_at",
  "uploaded_at",
  "sent_at",
  "entered_at",
  "period_start",
  "updated_at",
];

const modelsByName = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const enumsByName = new Map(Prisma.dmmf.datamodel.enums.map((e) => [e.name, e.values.map((v) => v.name)]));

export function humanize(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function modelLabel(model: string): string {
  return MODEL_LABELS[model] ?? humanize(model);
}

export function getModel(model: string): DmmfModel | undefined {
  return modelsByName.get(model);
}

export function allowedModels(role: Role): string[] {
  return (ROLE_MODELS[role] ?? []).filter((m) => modelsByName.has(m));
}

export function canExportModel(role: Role, model: string): boolean {
  return allowedModels(role).includes(model);
}

export function roleRowFilter(role: Role, model: string): Record<string, unknown> | undefined {
  return ROLE_ROW_FILTERS[role]?.[model];
}

export function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

export function primaryKey(model: DmmfModel): string {
  return model.fields.find((f) => f.isId)?.name ?? "id";
}

// Scalar + enum columns that may be exported (relations are separate).
export function exportableFields(model: DmmfModel): DmmfField[] {
  const excluded = EXCLUDED_FIELDS[model.name] ?? [];
  return model.fields.filter((f) => (f.kind === "scalar" || f.kind === "enum") && !excluded.includes(f.name));
}

export function relationFields(model: DmmfModel): DmmfField[] {
  return model.fields.filter((f) => f.kind === "object");
}

export function enumValues(enumName: string): string[] {
  return enumsByName.get(enumName) ?? [];
}

export function defaultDateField(model: DmmfModel): string | null {
  const dates = model.fields.filter((f) => f.kind === "scalar" && f.type === "DateTime" && !f.isList).map((f) => f.name);
  return DATE_FIELD_PRIORITY.find((d) => dates.includes(d)) ?? dates[0] ?? null;
}

export function labelPaths(model: DmmfModel): string[][] | null {
  if (LABEL_PATHS[model.name]) return LABEL_PATHS[model.name];
  const strings = model.fields.filter((f) => f.kind === "scalar" && f.type === "String" && !f.isList).map((f) => f.name);
  const field = LABEL_FIELD_CANDIDATES.find((c) => strings.includes(c));
  return field ? [[field]] : null;
}

// Resolves how a relation field links rows on both sides: the column on the
// parent row to collect values from, and the column on the related table to
// match them against. Works for both directions (the FK may live on either
// side) and for self-relations (User.supervisor / User.reports).
export function relationLink(
  model: DmmfModel,
  field: DmmfField
): { parentColumn: string; relatedColumn: string } | null {
  if (field.relationFromFields && field.relationFromFields.length > 0) {
    return { parentColumn: field.relationFromFields[0], relatedColumn: field.relationToFields?.[0] ?? "id" };
  }
  const target = modelsByName.get(field.type);
  const back = target?.fields.find(
    (f) =>
      f.kind === "object" &&
      f.relationName === field.relationName &&
      f !== field &&
      f.relationFromFields &&
      f.relationFromFields.length > 0
  );
  if (!back) return null;
  return { parentColumn: back.relationToFields?.[0] ?? "id", relatedColumn: back.relationFromFields![0] };
}

// The client-facing description of everything this role can export.
export function describeCatalog(role: Role) {
  const allowed = new Set(allowedModels(role));
  const tables = [...allowed].map((name) => {
    const model = modelsByName.get(name)!;
    const fields = exportableFields(model).map((f) => {
      // A scalar column that's the FK side of a relation, so the UI can
      // show "→ Candidates" next to candidate_id.
      const fkOf = relationFields(model).find((r) => r.relationFromFields?.includes(f.name));
      return {
        name: f.name,
        label: humanize(f.name),
        type: f.kind === "enum" ? "enum" : f.type,
        isList: f.isList,
        enumValues: f.kind === "enum" ? enumValues(f.type) : undefined,
        references: fkOf ? fkOf.type : undefined,
      };
    });
    const relations = relationFields(model)
      .filter((r) => allowed.has(r.type) && relationLink(model, r))
      .map((r) => ({
        name: r.name,
        label: humanize(r.name),
        model: r.type,
        isList: r.isList,
      }));
    return {
      name,
      label: modelLabel(name),
      category: CATEGORIES.find((c) => c.models.includes(name))?.key ?? "system",
      primaryKey: primaryKey(model),
      defaultDateField: defaultDateField(model),
      searchable: labelPaths(model) !== null,
      fields,
      relations,
    };
  });
  return {
    categories: CATEGORIES.map((c) => ({ key: c.key, label: c.label, models: c.models.filter((m) => allowed.has(m)) })).filter(
      (c) => c.models.length > 0
    ),
    tables,
  };
}
