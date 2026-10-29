"""Stripe Payment Links for case milestone payments, owned by FastAPI since
payments step 7.3 (docs/architecture/payments-handover.md): creating a link
for a payment stage's provisioned Price, and asking Stripe whether anyone
has paid one yet (the reconciliation for a webhook that never came).
"""

from __future__ import annotations

from typing import Protocol

import stripe

from app.core.config import settings
from app.services.stripe_pricing import STRIPE_API_VERSION


class PaymentLinkClient(Protocol):
    """The two Stripe calls case payments make (tests pass a fake)."""

    def create_link(self, *, price: str, metadata: dict[str, str]) -> tuple[str, str]: ...
    def paid_session(self, payment_link: str) -> str | None: ...


class StripePaymentLinkClient:
    def __init__(self, api_key: str) -> None:
        self._client = stripe.StripeClient(api_key, stripe_version=STRIPE_API_VERSION, max_network_retries=2)

    def create_link(self, *, price: str, metadata: dict[str, str]) -> tuple[str, str]:
        """The new link's id and URL."""
        link = self._client.v1.payment_links.create({"line_items": [{"price": price, "quantity": 1}], "metadata": metadata})
        return link.id, link.url

    def paid_session(self, payment_link: str) -> str | None:
        """A paid Checkout Session of this link (of its latest ten), if any."""
        sessions = self._client.v1.checkout.sessions.list({"payment_link": payment_link, "limit": 10})
        return next((s.id for s in sessions.data if s.payment_status == "paid"), None)


def payment_link_client() -> PaymentLinkClient | None:
    """The Stripe client, or None when STRIPE_SECRET_KEY isn't set."""
    return StripePaymentLinkClient(settings.STRIPE_SECRET_KEY) if settings.STRIPE_SECRET_KEY else None
