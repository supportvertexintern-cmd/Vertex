"""PayPal Orders v2, for application fees: a port of vertex/src/lib/paypal.ts
and the website's order routes, for payments step 7.2
(docs/architecture/payments-handover.md; owner's decision D2: FastAPI talks
to PayPal).

FastAPI never takes the browser's word for a payment: before capturing, it
reads the order from PayPal and checks it is this user's order for this
job's fee (the website's capture didn't, so any order could be recorded as
the fee).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.core.config import settings

TIMEOUT_SECONDS = 20


class PayPalNotConfigured(Exception):
    pass


class PayPalError(Exception):
    """PayPal refused or failed; the message is for logs only."""


@dataclass(frozen=True)
class Capture:
    capture_id: str
    amount: str
    currency: str


def reference(job_id: str, user_id: str) -> str:
    """What an order carries to say whose fee, for which job."""
    return f"{job_id}_{user_id}"


def _base() -> str:
    if not (settings.PAYPAL_CLIENT_ID and settings.PAYPAL_CLIENT_SECRET and settings.PAYPAL_API_BASE):
        raise PayPalNotConfigured
    return settings.PAYPAL_API_BASE.rstrip("/")


def _token(client: httpx.Client) -> str:
    res = client.post(
        f"{_base()}/v1/oauth2/token",
        auth=(settings.PAYPAL_CLIENT_ID or "", settings.PAYPAL_CLIENT_SECRET or ""),
        data={"grant_type": "client_credentials"},
    )
    if res.status_code != 200:
        raise PayPalError(f"token: {res.status_code}")
    return res.json()["access_token"]


def _call(method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
        token = _token(client)
        res = client.request(method, f"{_base()}{path}", headers={"Authorization": f"Bearer {token}"}, json=body)
    if res.status_code >= 300:
        raise PayPalError(f"{path}: {res.status_code}")
    return res.json()


def create_order(job_id: str, user_id: str, job_title: str, fee: float) -> str:
    """The order's id, for the browser's PayPal buttons to approve."""
    ref = reference(job_id, user_id)
    order = _call(
        "POST",
        "/v2/checkout/orders",
        {
            "intent": "CAPTURE",
            "purchase_units": [
                {
                    "reference_id": ref,
                    "custom_id": ref,
                    "amount": {"currency_code": "USD", "value": f"{fee:.2f}"},
                    "description": f"Application Fee for {job_title}",
                }
            ],
        },
    )
    return order["id"]


def capture_order(order_id: str, job_id: str, user_id: str, fee: float) -> Capture:
    """Checks the order is this user's, for this job's fee, then captures it.
    Raises PayPalError if it isn't, or if PayPal doesn't complete it."""
    if not order_id.replace("-", "").isalnum():
        raise PayPalError("order id")
    order = _call("GET", f"/v2/checkout/orders/{order_id}")
    unit = (order.get("purchase_units") or [{}])[0]
    amount = unit.get("amount") or {}
    if unit.get("custom_id") != reference(job_id, user_id) or amount.get("currency_code") != "USD" or amount.get("value") != f"{fee:.2f}":
        raise PayPalError("order is not this user's fee for this job")

    captured = _call("POST", f"/v2/checkout/orders/{order_id}/capture")
    if captured.get("status") != "COMPLETED":
        raise PayPalError(f"capture status {captured.get('status')}")
    capture = captured["purchase_units"][0]["payments"]["captures"][0]
    return Capture(capture["id"], capture["amount"]["value"], capture["amount"]["currency_code"])
