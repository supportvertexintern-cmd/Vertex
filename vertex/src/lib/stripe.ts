import Stripe from "stripe";

// Shared client for the newer Stripe surfaces this codebase uses
// (Product/Price provisioning, Payment Links) — the pre-existing
// application-fee Checkout flow (create-checkout/webhook routes) keeps its
// own separate instance; not worth touching working code just to
// consolidate, but new code shouldn't add a third copy of this same
// boilerplate.
export const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key_for_build") as string, {
  apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion,
});
