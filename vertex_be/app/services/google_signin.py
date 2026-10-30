"""Google sign-in (users and sessions step 8.2, D3 A): FastAPI exchanges the
code Google sent back to the website for tokens and reads who signed in,
straight from Google over TLS, so it never takes the website's word for
the user. The website keeps the start of the flow and the state check
(lib/google-oauth.ts).

The identity comes from Google's userinfo endpoint with the access token
just issued for this code; the ID token isn't used, so there is nothing of
it to verify.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import settings

TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
TIMEOUT_SECONDS = 10


class GoogleFailed(Exception):
    """Google refused the code, or didn't say who signed in. The message
    (google_token_failed or google_user_failed) is the code the website
    sends the visitor back with."""


@dataclass(frozen=True)
class GoogleUser:
    sub: str  # Google's own id for the account
    email: str | None
    email_verified: bool


class GoogleClient(Protocol):
    def user_for_code(self, code: str, redirect_uri: str) -> GoogleUser: ...


class HttpGoogleClient:
    def __init__(self, client_id: str, client_secret: str) -> None:
        self.client_id = client_id
        self.client_secret = client_secret

    def user_for_code(self, code: str, redirect_uri: str) -> GoogleUser:
        with httpx.Client(timeout=TIMEOUT_SECONDS) as http:
            try:
                tokens = http.post(TOKEN_URL, data={
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                }).json()
            except (httpx.HTTPError, ValueError) as err:
                raise GoogleFailed("google_token_failed") from err
            access_token = tokens.get("access_token") if isinstance(tokens, dict) else None
            if not access_token or tokens.get("error"):
                raise GoogleFailed("google_token_failed")
            try:
                info = http.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"}).json()
            except (httpx.HTTPError, ValueError) as err:
                raise GoogleFailed("google_user_failed") from err
        if not isinstance(info, dict) or not isinstance(info.get("sub"), str) or not info["sub"]:
            raise GoogleFailed("google_user_failed")
        email = info.get("email")
        # Only a literal true counts as verified.
        return GoogleUser(sub=info["sub"], email=email if isinstance(email, str) and email else None, email_verified=info.get("email_verified") is True)


def google_client() -> GoogleClient | None:
    """A FastAPI dependency; tests replace it with a stub. None when
    GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET isn't set."""
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        return None
    return HttpGoogleClient(settings.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_SECRET)
