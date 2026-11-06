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

// FastAPI sends every payment email itself since reads handover R7b
// (vertex_be/tests/test_payments.py, test_case_payments.py).

import * as rules from "@/app/api/admin/referral-commission-rules/route";
import * as webhook from "@/app/api/webhooks/stripe/route";
import * as createOrder from "@/app/api/payments/paypal/create-order/route";
import * as captureOrder from "@/app/api/payments/paypal/capture-order/route";
import * as casePayments from "@/app/api/cases/[id]/payments/route";
import * as paymentLink from "@/app/api/cases/[id]/payments/link/route";
import * as invoice from "@/app/api/cases/[id]/payments/invoice/route";
import * as onePayment from "@/app/api/cases/[id]/payments/[paymentId]/route";
import * as checkStatus from "@/app/api/cases/[id]/payments/[paymentId]/check-status/route";
import * as markPaid from "@/app/api/cases/[id]/payments/[paymentId]/mark-paid/route";
import * as receipt from "@/app/api/cases/[id]/payments/[paymentId]/receipt/route";

const req = (body?: string) =>
  new NextRequest("http://localhost/api/admin/referral-commission-rules", { method: "POST", body, headers: body ? { "content-type": "application/json" } : {} });

beforeEach(() => {
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

  it("captures through FastAPI, answering { success, paymentId }", async () => {
    state.role = "candidate";
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: { id: "pay1" }, notify: [] } });
    const res = await captureOrder.POST(post('{"orderID":"ORDER1","jobId":"j1"}'));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/payments/paypal/orders/ORDER1/capture", { method: "POST", body: { jobId: "j1" } });
    expect(await res.json()).toEqual({ success: true, paymentId: "pay1" });
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

describe("case payments (step 7.3)", () => {
  const ctx = { params: Promise.resolve({ id: "case1" }) };
  const one = { params: Promise.resolve({ id: "case1", paymentId: "pay1" }) };
  const send = (body?: string, method = "POST") =>
    new NextRequest("http://localhost/api/cases/case1/payments", { method, body, headers: body ? { "content-type": "application/json" } : {} });
  const row = { id: "pay1", status: "pending" };

  it("records through FastAPI, keeping the older string errors", async () => {
    state.role = "finance";
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: row } });
    const res = await casePayments.POST(send('{"job_payment_stage_id":"s1","amount":400}'), ctx);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/cases/case1/payments", { method: "POST", body: { job_payment_stage_id: "s1", amount: 400 } });
    expect([res.status, await res.json()]).toEqual([201, { data: row }]);
    callBackend.mockResolvedValueOnce({ ok: false, status: 403, error: { code: "fee_policy_disabled", message: "Not enabled." } });
    expect(await (await casePayments.POST(send("{}"), ctx)).json()).toEqual({ error: "Not enabled." });
    state.role = "operations_team";
    expect((await casePayments.POST(send("{}"), ctx)).status).toBe(403);
  });

  it("a payment link: FastAPI creates it (and emails the plan)", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: { payment: row, url: "https://buy.stripe.test/1" }, notify: [] } });
    const res = await paymentLink.POST(send('{"job_payment_stage_id":"s1","recipient":"candidate"}'), ctx);
    expect([res.status, await res.json()]).toEqual([201, { data: { payment: row, url: "https://buy.stripe.test/1" } }]);
  });

  it("a payment link keeps Stripe's failures as { error: { code, message } } and refusals as strings", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 502, error: { code: "stripe_link_failed", message: "Stripe is down" } });
    expect(await (await paymentLink.POST(send("{}"), ctx)).json()).toEqual({ error: { code: "stripe_link_failed", message: "Stripe is down" } });
    callBackend.mockResolvedValueOnce({ ok: false, status: 403, error: { code: "not_self_applicant", message: "Self-applicants only." } });
    expect(await (await paymentLink.POST(send("{}"), ctx)).json()).toEqual({ error: "Self-applicants only." });
  });

  const invoiceBody = '{"job_payment_stage_id":"s1","amount":400,"recipient":"partner","invoice_document_id":"d1"}';

  it("an invoice: FastAPI sends it and records it, in one call", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 201, body: { data: row } });
    const res = await invoice.POST(send(invoiceBody), ctx);
    expect([res.status, await res.json()]).toEqual([201, { data: row }]);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/cases/case1/payments/invoice", { method: "POST", body: JSON.parse(invoiceBody) });
  });

  it("an invoice's refusals are strings; a blocked file and a failed send keep { code, message }", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 404, error: { code: "not_found", message: "Invoice file not found for this candidate." } });
    expect(await (await invoice.POST(send(invoiceBody), ctx)).json()).toEqual({ error: "Invoice file not found for this candidate." });
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error: { code: "invoice_blocked", message: "Blocked." } });
    const blocked = await invoice.POST(send(invoiceBody), ctx);
    expect([blocked.status, await blocked.json()]).toEqual([422, { error: { code: "invoice_blocked", message: "Blocked." } }]);
    callBackend.mockResolvedValueOnce({ ok: false, status: 502, error: { code: "invoice_email_failed", message: "Failed to send invoice email." } });
    const failed = await invoice.POST(send(invoiceBody), ctx);
    expect([failed.status, (await failed.json()).error.code]).toEqual([502, "invoice_email_failed"]);
    state.role = "operations_team";
    expect((await invoice.POST(send(invoiceBody), ctx)).status).toBe(403);
  });

  it("check-status and mark-paid answer { data, message }; the receipt { data }", async () => {
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: row, message: "No completed payment found on Stripe yet." } });
    expect(await (await checkStatus.POST(send(), one)).json()).toEqual({ data: row, message: "No completed payment found on Stripe yet." });
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: row, message: "Marked as paid." } });
    expect(await (await markPaid.POST(send('{"receipt_document_id":"d1"}'), one)).json()).toEqual({ data: row, message: "Marked as paid." });
    expect(callBackend).toHaveBeenLastCalledWith("/api/v1/cases/case1/payments/pay1/mark-paid", { method: "POST", body: { receipt_document_id: "d1" } });
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: row } });
    expect(await (await receipt.PATCH(send('{"receipt_document_id":null}', "PATCH"), one)).json()).toEqual({ data: row });
    callBackend.mockResolvedValueOnce({ ok: false, status: 422, error: { code: "not_pending", message: "Already collected." } });
    expect(await (await markPaid.POST(send('{"receipt_document_id":"d1"}'), one)).json()).toEqual({ error: { code: "not_pending", message: "Already collected." } });
  });

  it("only finance removes a payment record, answered { message }", async () => {
    state.role = "director";
    expect((await onePayment.DELETE(send(undefined, "DELETE"), one)).status).toBe(403);
    state.role = "finance";
    callBackend.mockResolvedValueOnce({ ok: true, status: 200, body: { data: null, message: "Payment record removed." } });
    const res = await onePayment.DELETE(send(undefined, "DELETE"), one);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/cases/case1/payments/pay1", { method: "DELETE" });
    expect(await res.json()).toEqual({ message: "Payment record removed." });
  });
});
