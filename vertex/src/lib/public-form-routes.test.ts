import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The public contact form and the emailed CIF: this app keeps the rate limit
// and the form's messages, FastAPI sends the email since reads handover R7b
// (vertex_be/tests/test_public_forms.py).

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));

import * as contact from "@/app/api/contact/route";
import * as intake from "@/app/api/public-intake/application/route";

process.env.TRUST_PROXY_HEADERS = "true";
let ip = 0;
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/x", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-real-ip": `203.0.113.${++ip}` },
  });

beforeEach(() => {
  callBackend.mockReset();
  callBackend.mockResolvedValue({ ok: true, status: 201, body: { data: { sent: true } } });
});

const message = { name: "Sara", email: "sara@test.invalid", subject: "Partnership", message: "We'd like to work with you." };

describe("POST /api/contact", () => {
  it("passes the checked message on, as this app, and answers as before", async () => {
    const res = await contact.POST(post(message));
    expect([res.status, await res.json()]).toEqual([201, { success: true }]);
    expect(callBackend).toHaveBeenCalledWith("/api/v1/public-forms/contact", { method: "POST", body: message, asUser: false });
  });

  it("keeps its own validation messages, and a send that fails is a 502", async () => {
    const invalid = await contact.POST(post({ ...message, message: "short" }));
    expect([invalid.status, (await invalid.json()).error]).toEqual([422, "Validation failed"]);
    expect(callBackend).not.toHaveBeenCalled();
    callBackend.mockResolvedValueOnce({ ok: false, status: 502, error: { code: "send_failed", message: "x" } });
    const failed = await contact.POST(post(message));
    expect([failed.status, await failed.json()]).toEqual([
      502, { error: "We couldn't send your message right now. Please try again shortly or email us directly." },
    ]);
  });
});

const cif = {
  job_id: "cjld2cjxh0000qzrmn831i7rn", full_name: "Abebe Kebede", nationality: "Ethiopian", date_of_birth: "1990-01-01", passport_number: "EP1",
  passport_expiry: "2030-01-01", gender: "male", phone: "+251 911", email: "abebe@test.invalid", consent_given: true,
  earliest_travel_date: "2027-01-15", current_location_country_name: "Ethiopia", preferred_contact_channel: "email",
  payment_plan_acknowledged: true, available_for_embassy_appointment: true,
};

describe("POST /api/public-intake/application", () => {
  it("passes the form's fields on, as the user if signed in", async () => {
    const res = await intake.POST(post(cif));
    expect([res.status, await res.json()]).toEqual([201, { success: true }]);
    const [path, call] = callBackend.mock.calls[0];
    expect([path, call.asUser]).toEqual(["/api/v1/public-forms/intake", "if-signed-in"]);
    expect(call.body).toMatchObject({
      job_id: cif.job_id, full_name: "Abebe Kebede", passport_number: "EP1", documents_available: [], available_for_embassy_appointment: true,
      willing_to_start_within_30_days: false,
    });
    expect(call.body).not.toHaveProperty("date_of_birth"); // the email never showed it
  });

  it("a missing or closed job keeps its message; anything else is the 502", async () => {
    callBackend.mockResolvedValueOnce({ ok: false, status: 404, error: { code: "closed", message: "Applications for this programme are closed." } });
    const closed = await intake.POST(post(cif));
    expect([closed.status, await closed.json()]).toEqual([404, { error: "Applications for this programme are closed." }]);
    callBackend.mockResolvedValueOnce({ ok: false, status: 502, error: { code: "backend_unavailable", message: "x" } });
    const failed = await intake.POST(post(cif));
    expect([failed.status, (await failed.json()).error]).toEqual([
      502, "We couldn't submit your application right now. Please try again shortly or contact us directly.",
    ]);
    const invalid = await intake.POST(post({ ...cif, payment_plan_acknowledged: false }));
    expect(invalid.status).toBe(422);
  });
});
