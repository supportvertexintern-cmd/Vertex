import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Payments and finance move to FastAPI table by table (step 7,
// docs/architecture/payments-handover.md): each route checks the role and
// JSON early and passes the request on. FastAPI's rules are tested in
// vertex_be/tests (test_referral_commissions.py, …).

const state = vi.hoisted(() => ({ role: "admin" as string | null }));

vi.mock("@/lib/api-auth", () => {
  const deny = (status: number) => Response.json({ error: "denied" }, { status });
  return {
    getAuthUser: async () => (state.role ? { userId: "u1", email: "u@test.invalid", role: state.role, sid: "s", ver: 0 } : null),
    requireRole: (user: { role: string } | null, roles: readonly string[]) => (!user ? deny(401) : roles.includes(user.role) ? null : deny(403)),
    requireAuth: (user: unknown) => (user ? null : deny(401)),
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

// Emails and receipts are recorded, and sent at once.
const sent = vi.hoisted(() => [] as unknown[][]);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/invoice", () => ({ createReceiptPdf: async (...args: unknown[]) => void sent.push(["createReceiptPdf", ...args]) }));
vi.mock("@/lib/email", () => ({
  sendConsultationBookingNotification: async (...args: unknown[]) => void sent.push(["sendConsultationBookingNotification", ...args]),
}));

import * as rules from "@/app/api/admin/referral-commission-rules/route";
import * as webhook from "@/app/api/webhooks/stripe/route";
import * as createOrder from "@/app/api/payments/paypal/create-order/route";
import * as captureOrder from "@/app/api/payments/paypal/capture-order/route";

const req = (body?: string) =>
  new NextRequest("http://localhost/api/admin/referral-commission-rules", { method: "POST", body, headers: body ? { "content-type": "application/json" } : {} });

beforeEach(() => {
  sent.length = 0;
  state.role = "admin";
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 200, body: { data: { id: "r1", amount: 25 } } });
});

describe("commission rules (step 7.1)", () => {
  it("passes the upsert on and answers with FastAPI's envelope", async () => {
    const res = await rules.POST(req('{"country_id":"c1","milestone":"qualified","amount":25}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/referral-commission-rules", {
      method: "POST",
      body: { country_id: "c1", milestone: "qualified", amount: 25 },
    });
    expect([res.status, await res.json()]).toEqual([200, { data: { id: "r1", amount: 25 } }]);
  });

  it("refuses early: other roles, and a body that isn't JSON", async () => {
    state.role = "hr";
    expect((await rules.POST(req("{}"))).status).toBe(403);
    state.role = "admin";
    expect((await rules.POST(req("{nope"))).status).toBe(400);
    expect(callBackend).not.toHaveBeenCalled();
  });
});

describe("the Stripe webhook (step 7.2)", () => {
  const stripeEvent = '{"id":"evt_1","type":"checkout.session.completed"}';
  const delivery = (headers: Record<string, string> = { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" }) =>
    new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST", body: stripeEvent, headers });

  it("passes Stripe's exact bytes and signature on, as this app", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { received: true }, notify: [] } });
    const res = await webhook.POST(delivery());
    const [path, call] = callBackend.mock.calls[0];
    expect([path, call.asUser, call.forward, new TextDecoder().decode(call.raw.body)]).toEqual([
      "/api/v1/payments/stripe/webhook", false, { "Stripe-Signature": "t=1,v1=abc" }, stripeEvent,
    ]);
    expect([res.status, await res.json()]).toEqual([200, { received: true }]);
  });

  it("sends the receipt or booking email FastAPI lists", async () => {
    callBackend.mockResolvedValueOnce({
      ok: true, status: 200,
      body: { data: { received: true }, notify: [{ kind: "consultation_booked", full_name: "Sara", email: "s@test.invalid", phone: null, amount: 75, currency: "EUR" }] },
    });
    await webhook.POST(delivery());
    expect(sent).toEqual([["sendConsultationBookingNotification", { fullName: "Sara", email: "s@test.invalid", phone: null, amount: 75, currency: "EUR" }]]);
  });

  it("an error status for Stripe to retry when FastAPI refuses or is down", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 400, error: { code: "invalid_signature", message: "Webhook signature verification failed." } });
    expect((await webhook.POST(delivery())).status).toBe(400);
    callBackend.mockResolvedValueOnce({ ok: false, status: 502, error: { code: "backend_unavailable", message: "Unavailable." } });
    expect((await webhook.POST(delivery())).status).toBe(502);
  });
});

describe("PayPal (step 7.2)", () => {
  const post = (body: string) => new NextRequest("http://localhost/api/payments/paypal/x", { method: "POST", body, headers: { "content-type": "application/json" } });

  it("creates the order through FastAPI, answering { id }", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { id: "ORDER1" } } });
    const res = await createOrder.POST(post('{"jobId":"j1"}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/payments/paypal/orders", { method: "POST", body: { jobId: "j1" } });
    expect(await res.json()).toEqual({ id: "ORDER1" });
    expect((await createOrder.POST(post("{}"))).status).toBe(400);
  });

  it("captures through FastAPI, answering { success, paymentId } and sending the receipt", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce({
      ok: true, status: 200,
      body: {
        data: { id: "pay1" },
        notify: [{ kind: "payment_receipt", payment_id: "pay1", full_name: "Abebe", email: "a@test.invalid", job_title: "Care", amount: 49.5, transaction_id: "CAP1", date: "2026-10-29T10:00:00.000Z" }],
      },
    });
    const res = await captureOrder.POST(post('{"orderID":"ORDER1","jobId":"j1"}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/payments/paypal/orders/ORDER1/capture", { method: "POST", body: { jobId: "j1" } });
    expect(await res.json()).toEqual({ success: true, paymentId: "pay1" });
    expect(sent[0].slice(0, 3)).toEqual(["createReceiptPdf", "pay1", "Abebe"]);
  });

  it("a refused capture keeps the older error shape, and nobody signed in is 401", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce({ ok: false, status: 400, error: { code: "capture_failed", message: "Payment could not be captured." } });
    const res = await captureOrder.POST(post('{"orderID":"ORDER1","jobId":"j1"}'));
    expect([res.status, await res.json()]).toEqual([400, { error: "Payment could not be captured." }]);
    state.role = null;
    expect((await captureOrder.POST(post('{"orderID":"O","jobId":"j"}'))).status).toBe(401);
  });
});
