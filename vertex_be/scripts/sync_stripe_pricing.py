"""Syncs the Stripe Product and Prices of every active job's payment
stages, as the manual sync does for one job (POST
/api/v1/jobs/{id}/stripe-pricing/sync). Safe to repeat: a stage already in
sync makes no Stripe call. For a stack's first STRIPE_SECRET_KEY, run it in
that stack's backend:

    docker exec <stack>-backend-1 python scripts/sync_stripe_pricing.py

The stage writes are audited as the system's. Replaces the website's
vertex/scripts/sync-stripe-pricing.ts, which wrote them past FastAPI.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.audit import set_audit_actor  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.services.stripe_pricing import pricing_client, stripe_error_message, sync_active_jobs  # noqa: E402

client = pricing_client()
if client is None:
    sys.exit("STRIPE_SECRET_KEY isn't set.")

with SessionLocal() as db:
    set_audit_actor(db, None)
    results = sync_active_jobs(db, client)
    print(f"{len(results)} active job(s) with a fee.")
    for job, err in results:
        if err is None:
            priced = sum(1 for s in job.payment_stages if s.stripe_price_id)
            print(f"  ok      {job.title}: {priced} stage price(s)")
        else:
            print(f"  FAILED  {job.title}: {stripe_error_message(err)}")
sys.exit(1 if any(err for _, err in results) else 0)
