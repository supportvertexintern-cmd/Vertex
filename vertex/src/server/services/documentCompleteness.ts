import { prisma } from "@/lib/prisma";

export interface DocumentCompletenessResult {
  complete: boolean;
  missingTypes: string[];
}

/**
 * Required document type keys for a batch of destination countries in one
 * pass: the universal set (admin-managed DocumentRequirementType.
 * is_universal — Candidate Information Form §3's items with no "Required
 * for: X" tag) plus whatever extras each country requires (admin-managed
 * CountryDocumentRequirement) — one query for the universal set, one for
 * every country's extras `WHERE country_id IN (...)`, regardless of how
 * many applications/countries are being resolved. Callers that used to
 * call the single-country version once per application (candidate
 * dashboard, staff candidate detail, the screening-gate completeness
 * check below) turned that into an N+1 — 2 queries per application
 * instead of 2 total. Returns a lookup keyed by country id, plus `null`
 * for the universal-only set.
 */
export async function getRequiredDocumentTypesForCountryIds(
  countryIds: (string | null | undefined)[]
): Promise<Map<string | null, string[]>> {
  const uniqueIds = [...new Set(countryIds.filter((id): id is string => !!id))];

  const [universalTypes, countryExtras] = await Promise.all([
    prisma.documentRequirementType.findMany({ where: { is_universal: true }, select: { key: true } }),
    uniqueIds.length > 0
      ? prisma.countryDocumentRequirement.findMany({
          where: { country_id: { in: uniqueIds } },
          select: { country_id: true, document_type: true },
        })
      : Promise.resolve([] as { country_id: string; document_type: string }[]),
  ]);

  const universalKeys = universalTypes.map((t: { key: string }) => t.key);
  const extrasByCountry = new Map<string, string[]>();
  for (const extra of countryExtras as { country_id: string; document_type: string }[]) {
    const list = extrasByCountry.get(extra.country_id) ?? [];
    list.push(extra.document_type);
    extrasByCountry.set(extra.country_id, list);
  }

  const result = new Map<string | null, string[]>();
  result.set(null, universalKeys);
  for (const id of uniqueIds) {
    result.set(id, [...new Set([...universalKeys, ...(extrasByCountry.get(id) ?? [])])]);
  }
  return result;
}

/** Single-country convenience wrapper for the (common) case of resolving
 * just one destination — a thin pass-through to the batched version above
 * so there's one source of truth for the universal+extras merge logic. */
export async function getRequiredDocumentTypesForCountryId(countryId: string | null): Promise<string[]> {
  const map = await getRequiredDocumentTypesForCountryIds([countryId]);
  return map.get(countryId) ?? map.get(null) ?? [];
}

/**
 * What "documents submitted" means now that the Candidate Information
 * Form is filled in before any documents exist: the union of required
 * types across every one of the candidate's own non-rejected
 * applications, not just their most recent one — a candidate who applied
 * to two programmes with different document requirements still needs
 * both satisfied before they're "submitted", not just whichever
 * application happens to be newest.
 */
export async function evaluateDocumentCompletenessForCandidateId(candidateId: string): Promise<DocumentCompletenessResult> {
  const [documents, applications] = await Promise.all([
    prisma.document.findMany({ where: { candidate_id: candidateId }, select: { type: true } }),
    prisma.application.findMany({
      where: { candidate_id: candidateId, application_status: { not: "rejected" } },
      select: { preferred_country_1_id: true, job: { select: { country: true } } },
    }),
  ]);

  // A job-linked application (partner submissions, and any opportunities-
  // catalog application) has no preferred_country_1_id at all — resolve
  // its destination via Job.country against Vertex's admin-managed
  // Country rows by name (case-insensitive), same best-effort pattern used
  // everywhere else a free-text/derived country name needs a real id.
  const jobCountryNames = [
    ...new Set(
      applications
        .filter((a: (typeof applications)[number]) => !a.preferred_country_1_id && a.job)
        .map((a: (typeof applications)[number]) => a.job!.country)
    ),
  ];
  const jobCountries = jobCountryNames.length
    ? await prisma.country.findMany({ where: { name: { in: jobCountryNames, mode: "insensitive" } }, select: { id: true, name: true } })
    : [];
  const jobCountryIdByName = new Map(
    jobCountries.map((c: (typeof jobCountries)[number]) => [c.name.toLowerCase(), c.id])
  );

  const requiredByCountry = await getRequiredDocumentTypesForCountryIds(
    applications.map((a: (typeof applications)[number]) => a.preferred_country_1_id ?? (a.job ? jobCountryIdByName.get(a.job.country.toLowerCase()) : null) ?? null)
  );
  // requiredByCountry always has a `null` (universal-only) entry plus one
  // per distinct country among the applications — union every value since
  // any of those requirement sets being incomplete blocks "submitted".
  const requiredTypes = [...new Set([...requiredByCountry.values()].flat())];
  const uploadedTypes = new Set(documents.map((d: { type: string }) => d.type));
  const missingTypes = requiredTypes.filter((t) => !uploadedTypes.has(t));

  return { complete: missingTypes.length === 0, missingTypes };
}
