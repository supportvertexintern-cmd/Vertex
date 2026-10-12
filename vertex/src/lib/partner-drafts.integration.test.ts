// Schema drift follow-up (docs/security/dast-zap.md §3): the database can
// hold partner-candidate drafts (status "draft", required fields still
// empty) from the partner portal. This app has no draft flow, so drafts
// must be invisible: never listed, never opened, never a crash.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-drafts";
  return { token: "" };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "auth_token" && state.token ? { value: state.token } : undefined) }),
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionToken } from "@/lib/test-session";
import { GET as staffList } from "@/app/api/partner-candidates/route";
import { GET as staffGet } from "@/app/api/partner-candidates/[id]/route";
import { GET as partnerList } from "@/app/api/partner/candidates/route";
import { GET as partnerGet } from "@/app/api/partner/candidates/[id]/route";

const tag = `drafts-${Date.now()}`;
let partnerUserId = "";
let draftId = "";

beforeAll(async () => {
  partnerUserId = (await prisma.user.create({ data: { full_name: tag, email: `${tag}@test.invalid`, role: "partner" } })).id;
  const partner = await prisma.partner.create({
    data: {
      user_id: partnerUserId, name: `${tag} partner`, partner_type: "travel_agency", country_of_operation: "X",
      contact_name: "c", contact_email: `${tag}-contact@test.invalid`, contact_phone: "0",
    },
  });
  // A draft as the partner portal leaves it: most fields still empty.
  draftId = (await prisma.partnerCandidate.create({ data: { partner_id: partner.id, status: "draft", full_name: `${tag} draft` } })).id;
});

afterAll(async () => {
  await prisma.partnerCandidate.deleteMany({ where: { full_name: { startsWith: tag } } });
  await prisma.partner.deleteMany({ where: { name: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: { id: partnerUserId } });
});

const ctx = () => ({ params: Promise.resolve({ id: draftId }) });

describe("partner-candidate drafts are invisible to this app", () => {
  it("staff lists skip them, even when asked for status=draft", async () => {
    state.token = await sessionToken({ userId: "drafts-admin", email: "a@test.invalid", role: "admin" });
    for (const qs of ["", "?status=draft", `?q=${encodeURIComponent(tag)}`]) {
      const res = await staffList(new NextRequest(`http://localhost/api/partner-candidates${qs}`));
      expect(res.status).toBe(200);
      expect(JSON.stringify(await res.json())).not.toContain(draftId);
    }
  });

  it("staff can't open one", async () => {
    expect((await staffGet(new NextRequest(`http://localhost/api/partner-candidates/${draftId}`), ctx())).status).toBe(404);
  });

  it("the partner's own list skips it and it can't be opened", async () => {
    state.token = await sessionToken({ userId: partnerUserId, email: `${tag}@test.invalid`, role: "partner" });
    const res = await partnerList(new NextRequest("http://localhost/api/partner/candidates"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(draftId);
    expect((await partnerGet(new NextRequest(`http://localhost/api/partner/candidates/${draftId}`), ctx())).status).toBe(404);
  });
});
