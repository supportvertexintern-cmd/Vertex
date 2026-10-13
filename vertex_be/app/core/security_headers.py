"""Security response headers for the API (Phase 8, from the ZAP scan).

The API serves JSON only, so its pages may load nothing and be framed by
nothing. The interactive docs (/docs, /redoc) load Swagger UI and ReDoc
from a CDN, so they get the other headers but not the CSP.
"""

from starlette.types import ASGIApp, Message, Receive, Scope, Send

_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"cross-origin-resource-policy", b"same-origin"),
]
_API_CSP = (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'")
_DOCS_PATHS = ("/docs", "/redoc")


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_docs = scope.get("path", "").startswith(_DOCS_PATHS)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {k.lower() for k, _ in message.get("headers", [])}
                extra = _HEADERS if is_docs else [*_HEADERS, _API_CSP]
                message["headers"] = [*message.get("headers", []), *[h for h in extra if h[0] not in present]]
            await send(message)

        await self.app(scope, receive, send_with_headers)
