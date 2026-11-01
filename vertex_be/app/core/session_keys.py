"""The session key pair (docs/architecture/session-keys-handover.md, E8).

FastAPI signs access tokens with an ES256 private key only it holds; FastAPI
and the website verify them with the public keys. Each key travels as one
line of base64 of its PEM (D2 A), written by deploy/session-keys.sh:
SESSION_PRIVATE_KEY (backend only) and SESSION_PUBLIC_KEYS (both services,
comma-separated: the current key and, during a rotation, the previous one).

A token names its key in the `kid` header: the first 16 characters of the
base64url SHA-256 of the public key's DER SubjectPublicKeyInfo. lib/jwt.ts
computes the same.

No settings here, so app/core/config.py can check the keys at startup.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

ALGORITHM = "ES256"


class BadKey(ValueError):
    """A key that doesn't parse, or isn't an ES256 (P-256) key. Never
    includes the key."""


def _pem(value: str, name: str) -> bytes:
    try:
        return base64.b64decode(value.strip(), validate=True)
    except (binascii.Error, ValueError):
        raise BadKey(f"{name} is not base64") from None


def key_id(public: ec.EllipticCurvePublicKey) -> str:
    der = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return base64.urlsafe_b64encode(hashlib.sha256(der).digest()).decode().rstrip("=")[:16]


def _p256(key: object, name: str):
    curve = getattr(key, "curve", None)
    if not isinstance(curve, ec.SECP256R1):
        raise BadKey(f"{name} is not a P-256 (ES256) key")
    return key


@lru_cache
def public_keys(raw: str | None) -> dict[str, ec.EllipticCurvePublicKey]:
    """SESSION_PUBLIC_KEYS by key id. Empty when unset."""
    keys: dict[str, ec.EllipticCurvePublicKey] = {}
    for i, part in enumerate(p for p in (raw or "").split(",") if p.strip()):
        name = f"SESSION_PUBLIC_KEYS[{i}]"
        pem = _pem(part, name)
        try:
            public = serialization.load_pem_public_key(pem)
        except ValueError as err:
            raise BadKey(f"{name} is not a PEM public key") from err
        public = _p256(public, name)
        keys[key_id(public)] = public
    return keys


@lru_cache
def private_key(raw: str) -> tuple[str, ec.EllipticCurvePrivateKey]:
    """SESSION_PRIVATE_KEY and the id of its public half."""
    pem = _pem(raw, "SESSION_PRIVATE_KEY")
    try:
        private = serialization.load_pem_private_key(pem, password=None)
    except (ValueError, TypeError) as err:
        raise BadKey("SESSION_PRIVATE_KEY is not an unencrypted PEM private key") from err
    private = _p256(private, "SESSION_PRIVATE_KEY")
    return key_id(private.public_key()), private


def check(private_raw: str | None, public_raw: str | None) -> None:
    """Startup check: every listed key parses, and the private key's public
    half is listed, or every token it signs would be refused."""
    listed = public_keys(public_raw)
    if private_raw:
        kid, _ = private_key(private_raw)
        if kid not in listed:
            raise BadKey("SESSION_PRIVATE_KEY's public key is not in SESSION_PUBLIC_KEYS")
