import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Shared Country / Programme / Programme Country filtering for every list
// dashboard that shows an opportunity (Job) — HR Partner Submissions,
// Self Applications, and the HR/Operations/Management/Finance case lists.
// Each route only differs in how it reaches a Job (PartnerCandidate.job,
// Case.application.job, Candidate.applications[].job), so the route
// supplies "which jobs are in use" and wraps the returned Job filter in
// its own relation path.

// "Belgium — Warehouse Programme (Credit Service)" → "Warehouse Programme".
// Job has no separate programme field — the title is "<Country> —
// <Programme> (<variant>)" across every seeded opportunity, so the
// programme is derived from it rather than adding a schema column.
export function programmeFromJobTitle(title: string): string {
  const sep = title.indexOf(" — ");
  const rest = sep >= 0 ? title.slice(sep + 3) : title;
  return rest.replace(/\s*\([^)]*\)\s*$/, "").trim() || title;
}

export interface OpportunityFilterParams {
  country?: string;
  programme?: string;
  programmeCountry?: string;
}

export function readOpportunityFilterParams(req: NextRequest): OpportunityFilterParams {
  const get = (key: string) => req.nextUrl.searchParams.get(key)?.trim() || undefined;
  return { country: get("country"), programme: get("programme"), programmeCountry: get("programmeCountry") };
}

export interface OpportunityFilterOptions {
  countries: string[];
  programmes: string[];
  programme_countries: string[];
}

const sortedUnique = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));

// jobsInUse: the Jobs actually attached to this dashboard's records.
// - Country lists every country in the system (the Country reference
//   table, plus any job country missing from it), whether or not it has
//   a programme.
// - Programme / Programme Country list only what those records use, so
//   every option returns results — a catalog programme nobody has a
//   record for yet would otherwise only ever show an empty table.
// - jobWhere is null when no filter is active; otherwise a Job filter the
//   route nests under its own relation. Programme resolves to exact job
//   ids rather than a title substring match, so a programme name that
//   happens to be contained in another one (e.g. "Unskilled Worker")
//   can't pull in unrelated programmes.
export async function resolveOpportunityFilters(
  jobsInUse: Prisma.JobWhereInput,
  params: OpportunityFilterParams
): Promise<{ options: OpportunityFilterOptions; jobWhere: Prisma.JobWhereInput | null }> {
  const [usedJobs, allCountries] = await Promise.all([
    prisma.job.findMany({ where: jobsInUse, select: { id: true, title: true, country: true } }),
    prisma.country.findMany({ select: { name: true } }),
  ]);

  const options: OpportunityFilterOptions = {
    countries: sortedUnique([
      ...allCountries.map((c: (typeof allCountries)[number]) => c.name),
      ...usedJobs.map((j: (typeof usedJobs)[number]) => j.country),
    ]),
    programmes: sortedUnique(usedJobs.map((j: (typeof usedJobs)[number]) => programmeFromJobTitle(j.title))),
    programme_countries: sortedUnique(usedJobs.map((j: (typeof usedJobs)[number]) => j.country)),
  };

  const conditions: Prisma.JobWhereInput[] = [];
  if (params.country) conditions.push({ country: params.country });
  if (params.programmeCountry) conditions.push({ country: params.programmeCountry });
  if (params.programme) {
    const ids = usedJobs
      .filter((j: (typeof usedJobs)[number]) => programmeFromJobTitle(j.title) === params.programme)
      .map((j: (typeof usedJobs)[number]) => j.id);
    conditions.push({ id: { in: ids } });
  }

  return { options, jobWhere: conditions.length ? { AND: conditions } : null };
}
