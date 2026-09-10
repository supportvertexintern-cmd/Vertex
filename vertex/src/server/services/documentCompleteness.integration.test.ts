import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { evaluateDocumentCompletenessForCandidateId } from "./documentCompleteness";

let regionId: string;
let countryId: string;
let secondCountryId: string;
let candidateId: string;
let applicationId: string;
let secondApplicationId: string;
const documentIds: string[] = [];

beforeAll(async () => {
  const region = await prisma.region.create({ data: { name: "Doc Completeness Test Region" } });
  regionId = region.id;

  const country = await prisma.country.create({ data: { name: "Doc Completeness Test Country", region_id: regionId } });
  countryId = country.id;

  const secondCountry = await prisma.country.create({ data: { name: "Doc Completeness Second Country", region_id: regionId } });
  secondCountryId = secondCountry.id;

  await prisma.countryDocumentRequirement.create({
    data: { country_id: countryId, document_type: "national_id" },
  });
  await prisma.countryDocumentRequirement.create({
    data: { country_id: secondCountryId, document_type: "driving_licence" },
  });

  const candidate = await prisma.candidate.create({ data: { source: "self_registered" } });
  candidateId = candidate.id;

  const application = await prisma.application.create({
    data: { candidate_id: candidateId, preferred_country_1_id: countryId, application_status: "submitted" },
  });
  applicationId = application.id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  if (secondApplicationId) await prisma.application.delete({ where: { id: secondApplicationId } });
  await prisma.application.delete({ where: { id: applicationId } });
  await prisma.candidate.delete({ where: { id: candidateId } });
  await prisma.countryDocumentRequirement.deleteMany({ where: { country_id: { in: [countryId, secondCountryId] } } });
  await prisma.country.deleteMany({ where: { id: { in: [countryId, secondCountryId] } } });
  await prisma.region.delete({ where: { id: regionId } });
  await prisma.$disconnect();
});

async function upload(type: "cv" | "passport" | "passport_photo" | "national_id") {
  const doc = await prisma.document.create({
    data: { candidate_id: candidateId, type, storage_path: `/tmp/${type}.pdf` },
  });
  documentIds.push(doc.id);
}

describe("evaluateDocumentCompletenessForCandidateId", () => {
  it("is incomplete with nothing uploaded, missing the universal set plus the country extra", async () => {
    const result = await evaluateDocumentCompletenessForCandidateId(candidateId);
    expect(result.complete).toBe(false);
    expect(result.missingTypes).toEqual(expect.arrayContaining(["cv", "passport", "passport_photo", "national_id"]));
  });

  it("is still incomplete once only the universal set is uploaded — the country-specific extra remains", async () => {
    await upload("cv");
    await upload("passport");
    await upload("passport_photo");

    const result = await evaluateDocumentCompletenessForCandidateId(candidateId);
    expect(result.complete).toBe(false);
    expect(result.missingTypes).toEqual(["national_id"]);
  });

  it("is complete once the country-specific extra is also uploaded", async () => {
    await upload("national_id");

    const result = await evaluateDocumentCompletenessForCandidateId(candidateId);
    expect(result.complete).toBe(true);
    expect(result.missingTypes).toHaveLength(0);
  });

  it("unions requirements across every non-rejected application, not just the most recent one", async () => {
    // A second application to a different country with its own extra
    // requirement — before the fix, only the newest application's country
    // was consulted, so this second country's "driving_licence" would
    // have been silently ignored even though it's still outstanding.
    const secondApplication = await prisma.application.create({
      data: { candidate_id: candidateId, preferred_country_1_id: secondCountryId, application_status: "submitted" },
    });
    secondApplicationId = secondApplication.id;

    const result = await evaluateDocumentCompletenessForCandidateId(candidateId);
    expect(result.complete).toBe(false);
    expect(result.missingTypes).toEqual(["driving_licence"]);
  });
});
