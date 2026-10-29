# Payments and finance handover (backend plan step 7)

Status: **decided** (owner, 2026-10-29: D1 A, D2 A, D3 A, D4 A; §3). Follows
`data-ownership.md` §3 (Payments and finance) and the candidate pipeline
handover (`pipeline-handover.md`), whose patterns it reuses.

## 1. What moves

Every write to these tables moves from Next.js to FastAPI:

| Table | Written today by (Next.js) |
|---|---|
| `CasePayment` | `/api/cases/[id]/payments` (record), `/payments/link` (Stripe Payment Link), `/payments/invoice` (emailed invoice), `/payments/[paymentId]/check-status` (asks Stripe), `/mark-paid`, `/receipt`, `DELETE /payments/[paymentId]`; the Stripe webhook (a paid link) |
| `Payment` | the Stripe webhook (application fee by card), `/api/payments/paypal/capture-order` |
| `ConsultationBooking` | the Stripe webhook (a paid consultation) |
| `ReferralCommissionRule` | `/api/admin/referral-commission-rules` (upsert) |
| `JobMilestonePrice` | no runtime writer: only `prisma/seed.ts` through `stripeProvisioning.ts` |

That's 13 writes in 10 files. Unlike the pipeline, most of them talk to an
outside service: Stripe (payment links, status checks, the webhook,
checkout sessions) and PayPal (orders and captures).

As before, **writes move and reads stay** in Next.js (payment lists, the
case payment card, finance dashboards).

## 2. What makes this area different

### 2.1 Stripe and PayPal

FastAPI already calls Stripe for job pricing (step 3.2,
`app/services/stripe_pricing.py`, with the owner's decision: "FastAPI calls
Stripe, with a protected endpoint, every write audited"). Payment links,
status checks and the webhook would follow the same rule. PayPal has no
FastAPI client yet.

### 2.2 The webhook isn't audited today (G22)

The Stripe webhook and the PayPal capture write with plain Prisma: no
audit rows. `data-ownership.md` already ties fixing G22 to this move:
FastAPI audits every write it makes.

### 2.3 The webhook must be reachable from Stripe

Stripe posts to a public URL. Today that's the website's
`/api/webhooks/stripe`. FastAPI isn't published on the stacks (its port is
bound to this machine), and Stripe signs the raw body, so whoever writes
must see the body exactly as sent.

### 2.4 Receipts and invoices are files and emails

A card or PayPal payment generates a PDF receipt and emails it
(`lib/invoice.ts`); an invoice email attaches a file from storage. The
website sends every email today (pipeline decision D1).

## 3. Decisions

The owner chose the recommended option for each (2026-10-29): the website
passes the Stripe webhook through and FastAPI verifies it; FastAPI talks to
PayPal; the website keeps receipts and invoice emails; payments switch
table by table.

### D1. Who receives the Stripe webhook?

| Option | How | Cost |
|---|---|---|
| **A. The website passes it through (recommended)** | Stripe keeps calling `/api/webhooks/stripe`; the website passes the raw body and the `Stripe-Signature` header to FastAPI unchanged, and FastAPI verifies the signature with `STRIPE_WEBHOOK_SECRET` before writing | No change in Stripe's dashboard; nothing new exposed. FastAPI never trusts the website's word for the event: it checks Stripe's signature itself |
| B. Stripe calls FastAPI directly | A new public URL for FastAPI; the Stripe dashboard points at it | FastAPI must be published (it isn't, locally or on the stacks); two public services |

### D2. Who talks to PayPal?

| Option | How | Cost |
|---|---|---|
| **A. FastAPI, for create and capture (recommended)** | Port the PayPal client (token, create order, capture); FastAPI writes the `Payment` from the capture PayPal confirms | PayPal credentials move to the backend only, like Stripe's |
| B. The website captures, FastAPI records | The website calls PayPal, then asks FastAPI to write the row | FastAPI would take the website's word that a capture succeeded |

### D3. Receipts and invoice emails

| Option | How | Cost |
|---|---|---|
| **A. The website keeps them (recommended)** | Same as the pipeline (D1 there): FastAPI lists the receipt or invoice email in `notify`; the website builds the PDF or attaches the file and sends it | No email or PDF code moves |
| B. FastAPI | Port the PDF receipt and the emails | Duplicate templates until all email moves |

### D4. How does it switch?

| Option | How | Cost |
|---|---|---|
| **A. Table by table, like steps 2–5 (recommended)** | Each PR moves every writer of its tables and revokes `vertex_web`'s writes on them at once. Small enough for that: no flag needed | One release per sub-step; each is complete on its own |
| B. Built behind a flag, one switch | As the pipeline did | More machinery than a 13-write area needs |

## 4. Steps

| Step | What | Revokes from `vertex_web` |
|---|---|---|
| 7.1 | Commission rules: the admin upsert | `ReferralCommissionRule` |
| 7.2 | The Stripe webhook (all three branches: consultation, application fee, paid case link) and PayPal create and capture; receipts in `notify` | `Payment`, `ConsultationBooking` |
| 7.3 | Case payments: record, Stripe link, invoice, check-status, mark-paid, receipt, delete | `CasePayment` |
| 7.4 | `JobMilestonePrice`: decide whether it's still used (only the seed writes it), then revoke or drop | `JobMilestonePrice` |

In 7.2 the webhook's case branch already writes `CasePayment` through
FastAPI; `CasePayment` keeps two writers (both audited) until 7.3.

Each PR has the usual checks: role drift tests against the Next.js files,
the audit trail (fixing G22 for the webhook and PayPal), writes as
`vertex_api`, Stripe and PayPal mocked in the backend tests, and the
end-to-end journeys.

## 5. Risks

- **Webhook downtime:** if FastAPI is down, the website answers Stripe
  with an error and Stripe retries for up to three days, so no payment is
  lost; today a database error does the same.
- **Test mode:** Stripe and PayPal run in test/sandbox mode locally; the
  live keys are a deployment matter.

## 6. Progress

| Step | State |
|---|---|
| 7.1 | Done (#124): `vertex_be/app/api/v1/referral_commissions.py`, `upsert_rule` |
| 7.2 | Done (#125): `vertex_be/app/api/v1/payments.py`, the Stripe webhook and PayPal |
| 7.3 | `vertex_be/app/api/v1/case_payments.py`: record, Stripe link (the email in `notify`), invoice, check-status, mark-paid, receipt and delete, rule for rule; Stripe calls through `app/services/stripe_links.py`. The invoice email carries the file and is sent before the payment is recorded, so the website asks `/invoice/check` (writes nothing), sends it, then `/invoice` records it. The list (GET) stays a website read. `vertex_web` loses its writes on `CasePayment` |
