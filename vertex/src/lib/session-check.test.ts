import { afterEach, describe, expect, it, vi } from "vitest";

// What this app checks of a session since reads handover R7d (D2 A): the
// access token's signature (FastAPI's key) and expiry, then its claims. It
// reads no data itself, so that decides only which page or early refusal to
// show. Whether the session is still live (the user exists, token_version
// matches, the family isn't revoked) is FastAPI's check on every data call:
// vertex_be/tests/test_auth.py, which took over the cases this file's
// predecessor (session-revocation.integration.test.ts) ran against the
// database.

const state = vi.hoisted(() => ({ token: "" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "auth_token" && state.token ? { value: state.token } : undefined) }),
}));

import jwt from "jsonwebtoken";
import { getAuthUser } from "./api-auth";
import { signAccessToken } from "./test-tokens";

const claims = { userId: "u1", email: "a@test.invalid", role: "admin" as const, sid: "s1", ver: 3 };

afterEach(() => {
  state.token = "";
  vi.useRealTimers();
});

describe("getAuthUser", () => {
  it("is the token's claims once its signature checks out, without asking the database", async () => {
    state.token = signAccessToken(claims);
    expect(await getAuthUser()).toEqual(claims);
  });

  it("no token, or one that isn't FastAPI's, is nobody", async () => {
    expect(await getAuthUser()).toBeNull();
    state.token = "not-a-token";
    expect(await getAuthUser()).toBeNull();
    // Before G19 (no session id, the shared secret): refused.
    state.token = jwt.sign({ userId: "u1", email: "a@test.invalid", role: "admin" }, "irrelevant");
    expect(await getAuthUser()).toBeNull();
    // The right shape, signed with a key FastAPI didn't list.
    state.token = jwt.sign(claims, "x".repeat(32), { algorithm: "HS256" });
    expect(await getAuthUser()).toBeNull();
  });

  it("an expired token is nobody", async () => {
    state.token = signAccessToken(claims);
    vi.useFakeTimers({ now: Date.now() + 16 * 60_000 });
    expect(await getAuthUser()).toBeNull();
  });
});
