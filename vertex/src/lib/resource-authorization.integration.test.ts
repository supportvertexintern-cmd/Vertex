// Authorization pipeline, stage 5 (resource authorization), docs/security/
// authorization-pipeline.md: changing the ID in the URL must never reach
// another user's record. Each route a candidate or partner can call with a
// record ID is called twice through the real handler with a real session:
// by the owner (must succeed, proving the fixture is valid) and by another
// user of the same role with the owner's ID swapped in (must be denied).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-idor";
  return { token: "" };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "auth_token" && state.token ? { value: state.token } : undefined) }),
}));

import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sessionToken } from "@/lib/test-session";
import { GET as getApplication } from "@/app/api/applications/[id]/route";
import { GET as getCase } from "@/app/api/cases/[id]/route";
import { GET as getDocumentUrl } from "@/app/api/documents/[id]/signed-url/route";
import { GET as getMessages } from "@/app/api/candidates/[id]/messages/route";
import { GET as getPartnerSubmission } from "@/app/api/partner/candidates/[id]/route";

type Handler = (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
type Who = { userId: string; email: string; role: Role };

const tag = `idor-${Date.now()}`;
const ids: Record<string, string> = {};
const people: Record<string, Who> = {};

async function call(handler: Handler, who: Who | null, id: string): Promise<number> {
  state.token = who ? await sessionToken(who) : "";
  const res = await handler(new NextRequest(`http://localhost/api/x/${id}`), { params: Promise.resolve({ id }) });
  return res.status;
}

async function user(key: string, role: Role) {
  const u = await prisma.user.create({ data: { full_name: `${tag} ${key}`, email: `${tag}-${key}@test.invalid`, role } });
  people[key] = { userId: u.id, email: u.email, role };
  return u.id;
}

beforeAll(async () => {
  const job = await prisma.job.create({
    data: { title: `${tag} job`, country: "X", city: "X", job_description: "d", requirements: "r" },
  });
  ids.job = job.id;

  // Two candidates, each with an application, a case, a document and a thread.
  for (const key of ["candA", "candB"]) {
    const candidate = await prisma.candidate.create({ data: { user_id: await user(key, "candidate"), full_name: `${tag} ${key}` } });
    const application = await prisma.application.create({ data: { candidate_id: candidate.id, job_id: job.id } });
    const kase = await prisma.case.create({ data: { application_id: application.id } });
    const doc = await prisma.document.create({ data: { candidate_id: candidate.id, type: "cv", storage_path: `test/${tag}-${key}.pdf` } });
    await prisma.candidateMessage.create({ data: { candidate_id: candidate.id, sender_id: people[key].userId, body: "hello" } });
    Object.assign(ids, { [`${key}.candidate`]: candidate.id, [`${key}.application`]: application.id, [`${key}.case`]: kase.id, [`${key}.document`]: doc.id });
  }

  // Two partners, each with a submission bridged to a candidate with a case.
  for (const key of ["partnerA", "partnerB"]) {
    const partner = await prisma.partner.create({
      data: {
        user_id: await user(key, "partner"), name: `${tag} ${key}`, partner_type: "travel_agency", country_of_operation: "X",
        contact_name: "c", contact_email: `${tag}-${key}-contact@test.invalid`, contact_phone: "0",
      },
    });
    const candidate = await prisma.candidate.create({ data: { full_name: `${tag} ${key} sourced`, partner_id: partner.id } });
    const submission = await prisma.partnerCandidate.create({
      data: {
        partner_id: partner.id, full_name: `${tag} ${key} sourced`, date_of_birth: new Date("1990-01-01"), nationality: "X",
        passport_number: "P0", passport_expiry: new Date("2030-01-01"), job_id: job.id, earliest_travel_date: new Date("2027-01-01"),
        current_location_country_name: "X", bridged_candidate_id: candidate.id,
      },
    });
    const application = await prisma.application.create({ data: { candidate_id: candidate.id, job_id: job.id } });
    const kase = await prisma.case.create({ data: { application_id: application.id } });
    const doc = await prisma.document.create({ data: { candidate_id: candidate.id, type: "cv", storage_path: `test/${tag}-${key}.pdf` } });
    Object.assign(ids, { [`${key}.partner`]: partner.id, [`${key}.submission`]: submission.id, [`${key}.case`]: kase.id, [`${key}.document`]: doc.id });
  }
});

afterAll(async () => {
  const userIds = Object.values(people).map((p) => p.userId);
  const candidates = { full_name: { startsWith: tag } };
  await prisma.candidateMessage.deleteMany({ where: { candidate: candidates } });
  await prisma.document.deleteMany({ where: { candidate: candidates } });
  await prisma.case.deleteMany({ where: { application: { candidate: candidates } } });
  await prisma.application.deleteMany({ where: { candidate: candidates } });
  await prisma.partnerCandidate.deleteMany({ where: { full_name: { startsWith: tag } } });
  await prisma.candidate.deleteMany({ where: candidates });
  await prisma.partner.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.job.deleteMany({ where: { id: ids.job } });
});

// [route, owner, intruder, record key, handler]
const cases: [string, string, string, string, Handler][] = [
  ["GET /api/applications/[id]", "candB", "candA", "candB.application", getApplication],
  ["GET /api/cases/[id]", "candB", "candA", "candB.case", getCase],
  ["GET /api/documents/[id]/signed-url", "candB", "candA", "candB.document", getDocumentUrl],
  ["GET /api/candidates/[id]/messages", "candB", "candA", "candB.candidate", getMessages],
  ["GET /api/partner/candidates/[id]", "partnerB", "partnerA", "partnerB.submission", getPartnerSubmission],
  ["GET /api/cases/[id]", "partnerB", "partnerA", "partnerB.case", getCase],
  ["GET /api/documents/[id]/signed-url", "partnerB", "partnerA", "partnerB.document", getDocumentUrl],
];

describe("resource authorization: swapping the ID in the URL (pipeline stage 5)", () => {
  it.each(cases)("%s: the owner (%s) is allowed", async (_route, owner, _intruder, key, handler) => {
    expect(await call(handler, people[owner], ids[key])).toBe(200);
  });

  it.each(cases)("%s: %s's record requested by %s is denied", async (_route, _owner, intruder, key, handler) => {
    expect([403, 404]).toContain(await call(handler, people[intruder], ids[key]));
  });

  it.each(cases)("%s: without a session it's 401", async (_route, _owner, _intruder, key, handler) => {
    expect(await call(handler, null, ids[key])).toBe(401);
  });
});
