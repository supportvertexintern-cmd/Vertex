// Google sign-in links a Google account to an existing Vertex account. It
// must only do so for the browser that started the sign-in (the OAuth
// state), for an address Google has verified, and never to an account
// already linked to another Google account. A password nobody proved they
// own (the email was never verified) is dropped on linking.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-g19";
  process.env.GOOGLE_CLIENT_ID = "test-client";
});

import { NextRequest, type NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadSession, startSession } from "@/lib/session";
import { GOOGLE_STATE_COOKIE } from "@/lib/google-oauth";
import { GET as start } from "@/app/api/auth/google/route";
import { GET as callback } from "@/app/api/auth/google/callback/route";

const tag = `google-${Date.now()}`;
let seq = 0;
const created: string[] = [];
let google: { sub: string; email: string; email_verified: boolean };

async function makeUser(data: { email_verified?: boolean; password_hash?: string | null; google_id?: string } = {}) {
  const user = await prisma.user.create({
    data: { full_name: "Google Test", email: `${tag}-${seq++}@test.invalid`, role: "candidate", password_hash: "x", ...data },
  });
  created.push(user.id);
  return user;
}

/** Starts a sign-in as the browser would, returning its cookie and Google's state. */
async function begin(redirect = "/dashboard/profile") {
  const res = (await start(new NextRequest(`http://localhost/api/auth/google?redirect=${encodeURIComponent(redirect)}`))) as NextResponse;
  const state = new URL(res.headers.get("location")!).searchParams.get("state")!;
  return { cookie: res.cookies.get(GOOGLE_STATE_COOKIE)!, state };
}

async function returnFromGoogle(state: string | null, cookie: string | null): Promise<NextResponse> {
  const url = new URL("http://localhost/api/auth/google/callback?code=abc");
  if (state !== null) url.searchParams.set("state", state);
  return (await callback(new NextRequest(url, { headers: cookie ? { cookie: `${GOOGLE_STATE_COOKIE}=${cookie}` } : {} }))) as NextResponse;
}

async function signInWithGoogle() {
  const { cookie, state } = await begin();
  return returnFromGoogle(state, cookie.value);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    Response.json(String(url).includes("/token") ? { access_token: "at", id_token: "it" } : { name: "G", picture: "", ...google }),
  ));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("the OAuth state (login CSRF)", () => {
  it("is a nonce held in a short-lived Lax HttpOnly cookie", async () => {
    const { cookie, state } = await begin();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600, path: "/api/auth/google" });
    expect(state.startsWith(`${cookie.value}.`)).toBe(true);
  });

  it("a callback without the matching cookie never reaches Google", async () => {
    const { state } = await begin();
    for (const [s, c] of [[state, null], [state, "another-nonce"], [null, "x"], ["forged.L2Rhc2hib2FyZA", "forged-but-not-this"]] as const) {
      const res = await returnFromGoogle(s, c);
      expect(res.headers.get("location")).toContain("error=google_state_invalid");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a matching pair signs in, returns to the page asked for and drops the nonce", async () => {
    const user = await makeUser({ email_verified: true });
    google = { sub: `${tag}-sub-a`, email: user.email, email_verified: true };
    const res = await signInWithGoogle();
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard/profile");
    expect(res.cookies.get("auth_token")?.value).toBeTruthy();
    expect(res.cookies.get(GOOGLE_STATE_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });
});

describe("linking by email", () => {
  it("is refused when Google hasn't verified the address", async () => {
    const user = await makeUser({ email_verified: true });
    google = { sub: `${tag}-sub-b`, email: user.email, email_verified: false };
    const res = await signInWithGoogle();
    expect(res.headers.get("location")).toContain("error=google_email_unverified");
    expect(res.cookies.get("auth_token")).toBeUndefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).google_id).toBeNull();
  });

  it("is refused for an account linked to another Google account", async () => {
    const user = await makeUser({ email_verified: true, google_id: `${tag}-sub-owner` });
    google = { sub: `${tag}-sub-other`, email: user.email, email_verified: true };
    const res = await signInWithGoogle();
    expect(res.headers.get("location")).toContain("error=google_no_account");
    expect(res.cookies.get("auth_token")).toBeUndefined();
  });

  it("finds a linked account by Google's id, whatever email Google now reports", async () => {
    const user = await makeUser({ email_verified: true, google_id: `${tag}-sub-c` });
    google = { sub: `${tag}-sub-c`, email: "renamed@test.invalid", email_verified: false };
    const res = await signInWithGoogle();
    expect(res.cookies.get("auth_token")?.value).toBeTruthy();
    expect(res.headers.get("location")).not.toContain("error=");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  });

  it("links a verified address and keeps a proven password", async () => {
    const user = await makeUser({ email_verified: true });
    google = { sub: `${tag}-sub-d`, email: user.email, email_verified: true };
    await signInWithGoogle();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect([after.google_id, after.password_hash, after.token_version]).toEqual([`${tag}-sub-d`, "x", user.token_version]);
  });

  it("pre-hijack: drops a password set on an unverified account, ending its sessions", async () => {
    const planted = await makeUser({ email_verified: false, password_hash: "attacker-knows-this" });
    const attacker = await startSession(planted, null);
    google = { sub: `${tag}-sub-e`, email: planted.email, email_verified: true };
    const res = await signInWithGoogle();
    expect(res.cookies.get("auth_token")?.value).toBeTruthy();
    const after = await prisma.user.findUniqueOrThrow({ where: { id: planted.id } });
    expect([after.google_id, after.email_verified, after.password_hash]).toEqual([`${tag}-sub-e`, true, null]);
    expect((await loadSession(planted.id, attacker.familyId, planted.token_version)).user).toBeNull();
  });

  it("an unknown address is still refused", async () => {
    google = { sub: `${tag}-sub-f`, email: `${tag}-nobody@test.invalid`, email_verified: true };
    const res = await signInWithGoogle();
    expect(res.headers.get("location")).toContain("error=google_no_account");
  });
});
