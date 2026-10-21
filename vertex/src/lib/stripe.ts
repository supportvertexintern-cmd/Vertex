import Stripe from "stripe";

// The Stripe API version every client here sends. The stripe package's
// types describe its own, newer version (SDK 23: 2026-09-30.endive), so a
// field the types offer isn't necessarily returned under this one; moving
// to a newer version is a separate migration, checked against Stripe's API
// changelog and test-mode payments.
export const STRIPE_API_VERSION = "2025-02-24.acacia" as Stripe.LatestApiVersion;

// Card-only Checkout. `payment_method_types` is gone from the SDK's types
// (removed in a later API version) but still applies under
// STRIPE_API_VERSION, where leaving it out would switch Checkout to
// whatever payment methods the Stripe Dashboard has enabled.
export const CARD_ONLY_CHECKOUT = { payment_method_types: ["card"] } as Partial<Stripe.Checkout.SessionCreateParams>;

// Shared client for the newer Stripe surfaces this codebase uses
// (Product/Price provisioning, Payment Links) — the pre-existing
// application-fee Checkout flow (create-checkout/webhook routes) keeps its
// own separate instance; not worth touching working code just to
// consolidate, but new code shouldn't add a third copy of this same
// boilerplate.
export const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_build") as string, {
  apiVersion: STRIPE_API_VERSION,
});
