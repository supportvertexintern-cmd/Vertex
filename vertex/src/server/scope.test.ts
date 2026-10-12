import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { scopeCandidatesToRequester, canAccessCandidate } from "./scope";
import type { JwtPayload } from "@/lib/jwt";

// Integration tests against a real (local, disposable) Postgres database —
// this is exactly the kind of authorization logic where a bug is a data
// leak, not a cosmetic issue, so it's worth testing against real queries
// rather than mocking Prisma.

let regionId: string;
let countryAId: string;
let countryBId: string;
let recruiterA: string;
let supervisorA: string;
let candidateInA: string;
let candidateInB: string;

function actor(userId: string, role: JwtPayload["role"]): JwtPayload {
  return { userId, email: `${userId}@test.local`, role, sid: "test", ver: 0 };
}

beforeAll(async () => {
  const region = await prisma.region.create({ data: { name: "Test Region" } });
  regionId = region.id;

  const countryA = await prisma.country.create({ data: { name: "Test Country A", region_id: regionId } });
  const countryB = await prisma.country.create({ data: { name: "Test Country B", region_id: regionId } });
  countryAId = countryA.id;
  countryBId = countryB.id;

  const recruiter = await prisma.user.create({
    data: { full_name: "Recruiter A", email: "recruiter-a@test.local", role: "regional_recruiter", assigned_country_id: countryAId },
  });
  recruiterA = recruiter.id;

  const supervisor = await prisma.user.create({
    data: { full_name: "Supervisor A", email: "supervisor-a@test.local", role: "country_supervisor", assigned_country_id: countryAId },
  });
  supervisorA = supervisor.id;

  const candA = await prisma.candidate.create({
    data: { source: "recruiter_sourced", recruiter_id: recruiterA, country_id: countryAId },
  });
  candidateInA = candA.id;

  const candB = await prisma.candidate.create({
    data: { source: "recruiter_sourced", country_id: countryBId },
  });
  candidateInB = candB.id;
});

afterAll(async () => {
  await prisma.candidate.deleteMany({ where: { id: { in: [candidateInA, candidateInB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [recruiterA, supervisorA] } } });
  await prisma.country.deleteMany({ where: { id: { in: [countryAId, countryBId] } } });
  await prisma.region.delete({ where: { id: regionId } });
  await prisma.$disconnect();
});

describe("scopeCandidatesToRequester", () => {
  it("scopes a regional_recruiter to only their sourced candidates", async () => {
    const where = await scopeCandidatesToRequester(actor(recruiterA, "regional_recruiter"));
    const results = await prisma.candidate.findMany({ where: { AND: [where, { id: { in: [candidateInA, candidateInB] } }] } });
    expect(results.map((r: { id: string }) => r.id)).toEqual([candidateInA]);
  });

  it("scopes a country_supervisor to their assigned country", async () => {
    const where = await scopeCandidatesToRequester(actor(supervisorA, "country_supervisor"));
    const results = await prisma.candidate.findMany({ where: { AND: [where, { id: { in: [candidateInA, candidateInB] } }] } });
    expect(results.map((r: { id: string }) => r.id)).toEqual([candidateInA]);
  });

  it("fails closed for a country_supervisor with no assigned country", async () => {
    const unassigned = await prisma.user.create({
      data: { full_name: "Unassigned Supervisor", email: "unassigned-sup@test.local", role: "country_supervisor" },
    });
    try {
      const where = await scopeCandidatesToRequester(actor(unassigned.id, "country_supervisor"));
      const results = await prisma.candidate.findMany({ where: { AND: [where, { id: { in: [candidateInA, candidateInB] } }] } });
      expect(results).toHaveLength(0);
    } finally {
      await prisma.user.delete({ where: { id: unassigned.id } });
    }
  });

  it("gives admin and director unrestricted access", async () => {
    for (const role of ["admin", "director"] as const) {
      const where = await scopeCandidatesToRequester(actor("whoever", role));
      const results = await prisma.candidate.findMany({ where: { AND: [where, { id: { in: [candidateInA, candidateInB] } }] } });
      expect(results.map((r: { id: string }) => r.id).sort()).toEqual([candidateInA, candidateInB].sort());
    }
  });

  // inhouse_supervisor is scoped to their assigned countries, same as
  // country_supervisor — not a global overseer like admin/director. Can
  // be assigned more than one country (2026-07), so this exercises the
  // multi-country case directly rather than just mirroring the
  // single-country country_supervisor test above.
  it("scopes an inhouse_supervisor to their assigned countries (including several at once)", async () => {
    const inhouse = await prisma.user.create({
      data: { full_name: "Inhouse A", email: "inhouse-a@test.local", role: "inhouse_supervisor" },
    });
    try {
      const unassignedWhere = await scopeCandidatesToRequester(actor(inhouse.id, "inhouse_supervisor"));
      const unassignedResults = await prisma.candidate.findMany({
        where: { AND: [unassignedWhere, { id: { in: [candidateInA, candidateInB] } }] },
      });
      expect(unassignedResults).toHaveLength(0);

      await prisma.inhouseCountryAssignment.createMany({
        data: [
          { inhouse_supervisor_id: inhouse.id, country_id: countryAId },
          { inhouse_supervisor_id: inhouse.id, country_id: countryBId },
        ],
      });
      const bothWhere = await scopeCandidatesToRequester(actor(inhouse.id, "inhouse_supervisor"));
      const bothResults = await prisma.candidate.findMany({
        where: { AND: [bothWhere, { id: { in: [candidateInA, candidateInB] } }] },
      });
      expect(bothResults.map((r: { id: string }) => r.id).sort()).toEqual([candidateInA, candidateInB].sort());
    } finally {
      await prisma.inhouseCountryAssignment.deleteMany({ where: { inhouse_supervisor_id: inhouse.id } });
      await prisma.user.delete({ where: { id: inhouse.id } });
    }
  });
});

describe("canAccessCandidate", () => {
  it("allows the recruiter who sourced the candidate", async () => {
    const allowed = await canAccessCandidate(actor(recruiterA, "regional_recruiter"), {
      user_id: null,
      recruiter_id: recruiterA,
      country_id: countryAId,
    });
    expect(allowed).toBe(true);
  });

  it("denies a recruiter who did not source the candidate", async () => {
    const allowed = await canAccessCandidate(actor("some-other-recruiter", "regional_recruiter"), {
      user_id: null,
      recruiter_id: recruiterA,
      country_id: countryAId,
    });
    expect(allowed).toBe(false);
  });

  it("allows the country_supervisor for that candidate's country", async () => {
    const allowed = await canAccessCandidate(actor(supervisorA, "country_supervisor"), {
      user_id: null,
      recruiter_id: recruiterA,
      country_id: countryAId,
    });
    expect(allowed).toBe(true);
  });

  it("denies a country_supervisor for a different country", async () => {
    const allowed = await canAccessCandidate(actor(supervisorA, "country_supervisor"), {
      user_id: null,
      recruiter_id: null,
      country_id: countryBId,
    });
    expect(allowed).toBe(false);
  });

  it("allows an inhouse_supervisor assigned to several countries into candidates from any of them", async () => {
    const inhouse = await prisma.user.create({
      data: { full_name: "Inhouse B", email: "inhouse-b@test.local", role: "inhouse_supervisor" },
    });
    try {
      await prisma.inhouseCountryAssignment.createMany({
        data: [
          { inhouse_supervisor_id: inhouse.id, country_id: countryAId },
          { inhouse_supervisor_id: inhouse.id, country_id: countryBId },
        ],
      });
      expect(
        await canAccessCandidate(actor(inhouse.id, "inhouse_supervisor"), { user_id: null, recruiter_id: null, country_id: countryAId })
      ).toBe(true);
      expect(
        await canAccessCandidate(actor(inhouse.id, "inhouse_supervisor"), { user_id: null, recruiter_id: null, country_id: countryBId })
      ).toBe(true);
    } finally {
      await prisma.inhouseCountryAssignment.deleteMany({ where: { inhouse_supervisor_id: inhouse.id } });
      await prisma.user.delete({ where: { id: inhouse.id } });
    }
  });

  // A partner-sourced candidate skips the recruiter/country_supervisor
  // funnel entirely (2026-07-27) — its only non-director/admin accessor is
  // the sourcing partner itself, scoped by Candidate.partner_id, not any
  // country/recruiter field (which stay null for these candidates).
  it("allows a partner to access only the candidate it bridged itself, not another partner's", async () => {
    const partnerUser = await prisma.user.create({
      data: { full_name: "Partner User", email: "partner-user-scope-test@test.local", role: "partner" },
    });
    const partner = await prisma.partner.create({
      data: {
        name: "Test Partner Agency (scope test)",
        partner_type: "manpower_supplier",
        country_of_operation: "Testland",
        contact_name: "Contact Person",
        contact_email: "partner-contact-scope-test@test.local",
        contact_phone: "+10000000000",
        user_id: partnerUser.id,
      },
    });
    try {
      const ownCandidateCheck = { user_id: null, recruiter_id: null, country_id: null, partner_id: partner.id };
      const otherPartnersCandidateCheck = { user_id: null, recruiter_id: null, country_id: null, partner_id: "some-other-partner-id" };
      expect(await canAccessCandidate(actor(partnerUser.id, "partner"), ownCandidateCheck)).toBe(true);
      expect(await canAccessCandidate(actor(partnerUser.id, "partner"), otherPartnersCandidateCheck)).toBe(false);
    } finally {
      await prisma.partner.delete({ where: { id: partner.id } });
      await prisma.user.delete({ where: { id: partnerUser.id } });
    }
  });
});
