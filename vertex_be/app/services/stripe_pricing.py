"""Stripe pricing for job payment stages, owned by FastAPI since the jobs
handover (backend plan step 3.2). A port of Next.js's
server/services/stripeProvisioning.ts, which the website no longer calls.

One Stripe Product per payment stage, with a Price for the stage's share of
the job's service fee. A stage gets its Product and Price on its first
sync; when its amount changes, a new Price on the same Product becomes the
default (Prices are immutable). An unchanged amount is a no-op, so a sync
is safe to repeat.

Every stage change goes through the ORM, so it is on the audit trail with
the actor who asked for it, and is committed stage by stage: what Stripe
created is recorded even if a later stage fails. Stripe requests carry
idempotency keys, so a retry after a failure in between doesn't create a
second Product or Price.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Any, Protocol

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import set_audit_actor
from app.core.config import settings
from app.core.logging import log_event
from app.models.jobs import Job, JobPaymentStage

# The Stripe API version every request sends, as Next.js's lib/stripe.ts.
STRIPE_API_VERSION = "2025-02-24.acacia"


class StripeNotConfigured(RuntimeError):
    pass


class PricingClient(Protocol):
    """The three Stripe calls a sync makes (tests pass a fake)."""

    def create_product(self, *, name: str, description: str, idempotency_key: str) -> str: ...
    def create_price(self, *, product: str, unit_amount: int, idempotency_key: str) -> str: ...
    def set_default_price(self, product: str, price: str) -> None: ...


class StripePricingClient:
    def __init__(self, api_key: str) -> None:
        self._client = stripe.StripeClient(api_key, stripe_version=STRIPE_API_VERSION, max_network_retries=2)

    def create_product(self, *, name: str, description: str, idempotency_key: str) -> str:
        product = self._client.v1.products.create({"name": name, "description": description}, {"idempotency_key": idempotency_key})
        return product.id

    def create_price(self, *, product: str, unit_amount: int, idempotency_key: str) -> str:
        price = self._client.v1.prices.create(
            {"product": product, "unit_amount": unit_amount, "currency": "gbp"}, {"idempotency_key": idempotency_key}
        )
        return price.id

    def set_default_price(self, product: str, price: str) -> None:
        self._client.v1.products.update(product, {"default_price": price})


def pricing_client() -> PricingClient | None:
    """The Stripe client, or None when STRIPE_SECRET_KEY isn't set."""
    return StripePricingClient(settings.STRIPE_SECRET_KEY) if settings.STRIPE_SECRET_KEY else None


def _round2(n: float) -> float:
    # JavaScript's Math.round (half up), as lib/fees.ts rounds: Python's
    # round() rounds half to even and would give different pennies.
    return math.floor(n * 100 + 0.5) / 100


def payment_stage_amounts(total_gbp: float, percents: list[float]) -> list[float]:
    """lib/fees.ts's computePaymentStageAmounts: each stage's share, with
    the last stage taking the rounding remainder."""
    if not percents:
        return []
    staged_total = _round2(total_gbp * sum(percents) / 100)
    amounts: list[float] = []
    allocated = 0.0
    for i, percent in enumerate(percents):
        if i == len(percents) - 1:
            amounts.append(_round2(staged_total - allocated))
        else:
            amount = _round2(total_gbp * percent / 100)
            allocated += amount
            amounts.append(amount)
    return amounts


def product_name(job: Job) -> str:
    """e.g. "Serbia, Visa D, 6 months" from duration_permit "6 months · TRC possible"."""
    duration = (job.duration_permit or "").split("·")[0].strip()
    return ", ".join(part for part in (job.country, job.visa_type, duration) if part)


def sync_job_pricing(db: Session, job_id: str, client: PricingClient) -> list[JobPaymentStage]:
    """Provisions or re-syncs the Stripe Product and Price of each of the
    job's payment stages. Raises on a Stripe error; stages done before it
    stay recorded. Returns the job's stages, in order."""
    job = db.get(Job, job_id)
    stages = list(db.scalars(select(JobPaymentStage).where(JobPaymentStage.job_id == job_id).order_by(JobPaymentStage.order)))
    # A job with no fee, or no stages yet: nothing to charge.
    if job is None or not job.service_fee_gbp or not stages:
        return stages

    name = product_name(job)
    amounts = payment_stage_amounts(job.service_fee_gbp, [s.percent for s in stages])
    for stage, amount in zip(stages, amounts, strict=True):
        if amount <= 0:
            continue  # e.g. a 0% "Upfront" stage
        cents = round(amount * 100)
        if not stage.stripe_product_id or not stage.stripe_price_id:
            product = client.create_product(name=name, description=stage.label, idempotency_key=f"vertex-stage-{stage.id}-product")
            price = client.create_price(product=product, unit_amount=cents, idempotency_key=f"vertex-stage-{stage.id}-{product}-{cents}")
            client.set_default_price(product, price)
            stage.stripe_product_id, stage.stripe_price_id, stage.synced_amount_gbp = product, price, amount
            db.commit()
        elif stage.synced_amount_gbp != amount:
            product = stage.stripe_product_id
            price = client.create_price(product=product, unit_amount=cents, idempotency_key=f"vertex-stage-{stage.id}-{product}-{cents}")
            client.set_default_price(product, price)
            stage.stripe_price_id, stage.synced_amount_gbp = price, amount
            db.commit()
    return stages


SessionFactory = Callable[[], AbstractContextManager[Session]]


def sync_after_save(sessions: SessionFactory, client: PricingClient | None, job_id: str, actor_id: str) -> None:
    """Runs after a job save's response is sent (a background task): a
    Stripe outage never blocks or fails the save. A failure is logged; the
    marketing team can retry with the manual sync."""
    if client is None:
        log_event(logging.WARNING, "stripe.pricing_not_configured", job_id=job_id)
        return
    with sessions() as db:
        set_audit_actor(db, actor_id)
        try:
            sync_job_pricing(db, job_id, client)
        except Exception as err:  # noqa: BLE001  (logged; the save already succeeded)
            db.rollback()
            log_event(logging.ERROR, "stripe.pricing_sync_failed", job_id=job_id, error=type(err).__name__)


def stripe_error_message(err: Exception) -> str:
    message: Any = getattr(err, "user_message", None) or getattr(err, "_message", None)
    return str(message) if message else "Failed to sync Stripe pricing."
