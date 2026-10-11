"""Writes the ZAP Automation Framework plans for a DAST scan of one stack.

    python make_plans.py <routes.json> <out_dir>

Two plans: unauthenticated, and authenticated (a session cookie for a
dedicated scan account, added to every request by ZAP's replacer; the
plan holds a placeholder, filled in from ZAP_AUTH_TOKEN inside the
container, so the token is never on the host or on a command line). Next.js renders most pages in the browser and its API routes aren't
linked from pages, so a spider alone would miss them: every route from the
code inventory is seeded, writes with a minimal JSON body. The FastAPI
backend is scanned from its OpenAPI document.
"""

import json
import sys
from pathlib import Path

NEXT = "http://nextjs:3000"
# Filled in inside the ZAP container from ZAP_AUTH_TOKEN (scan-staging.sh):
# ZAP 2.17 doesn't expand ${ENV} in replacer rules, and the token must never
# be written to the host.
TOKEN_PLACEHOLDER = "__ZAP_AUTH_TOKEN__"
API = "http://backend:8000"

# Not seeded: logging out would end the authenticated scan's session, and
# uploads are multipart (covered by the Phase 9 upload tests instead).
SKIP = {("POST", "/api/auth/logout"), ("POST", "/api/upload")}


def yaml_str(s: str) -> str:
    return json.dumps(s)  # JSON strings are valid YAML scalars


def plan(routes: list[list[str]], authenticated: bool, name: str) -> str:
    lines = [
        "env:",
        "  contexts:",
        "    - name: nextjs",
        f"      urls: [{yaml_str(NEXT)}]",
        f"      includePaths: [{yaml_str(NEXT + '.*')}]",
        f"      excludePaths: [{yaml_str(NEXT + '/api/auth/logout.*')}, {yaml_str(NEXT + '/_next/static/.*')}]",
        "    - name: backend",
        f"      urls: [{yaml_str(API)}]",
        f"      includePaths: [{yaml_str(API + '.*')}]",
        "  parameters:",
        "    failOnError: false",
        "    failOnWarning: false",
        "    progressToStdout: true",
        "jobs:",
    ]
    if authenticated:
        lines += [
            "  - type: replacer",
            "    parameters:",
            "      deleteAllRules: true",
            "    rules:",
            "      - description: scan account session",
            "        matchType: req_header",
            "        matchString: Cookie",
            "        matchRegex: false",
            f'        replacementString: "auth_token={TOKEN_PLACEHOLDER}"',
        ]
    lines += ["  - type: requestor", "    requests:"]
    # Canary: proves the session works (or that its absence is noticed).
    # scan-staging.sh fails the run if ZAP reports a different code.
    lines += [
        f"      - url: {yaml_str(NEXT + '/api/auth/me')}",
        "        method: GET",
        f"        responseCode: {200 if authenticated else 401}",
    ]
    for method, path in routes:
        if (method, path) in SKIP:
            continue
        lines += [f"      - url: {yaml_str(NEXT + path)}", f"        method: {method}"]
        if method != "GET":
            lines += ['        data: "{}"', '        headers: ["Content-Type: application/json"]']
    lines += [
        "  - type: openapi",
        "    parameters:",
        f"      apiUrl: {yaml_str(API + '/api/v1/openapi.json')}",
        f"      targetUrl: {yaml_str(API)}",
        "      context: backend",
        "  - type: spider",
        "    parameters:",
        "      context: nextjs",
        "      maxDuration: 3",
        "  - type: passiveScan-wait",
        "    parameters:",
        "      maxDuration: 5",
        "  - type: activeScan",
        "    parameters:",
        "      context: nextjs",
        "      maxRuleDurationInMins: 2",
        "      maxScanDurationInMins: 25",
        "  - type: activeScan",
        "    parameters:",
        "      context: backend",
        "      maxScanDurationInMins: 5",
        "  - type: passiveScan-wait",
        "    parameters:",
        "      maxDuration: 5",
    ]
    for template, ext in (("traditional-json", "json"), ("traditional-md", "md")):
        lines += [
            "  - type: report",
            "    parameters:",
            f"      template: {template}",
            "      reportDir: /zap/wrk",
            f"      reportFile: {name}",
            f"      reportTitle: {yaml_str('Vertex DAST: ' + name)}",
        ]
    return "\n".join(lines) + "\n"


def main() -> None:
    routes = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    (out / "plan-unauthenticated.yaml").write_text(plan(routes, False, "zap-unauthenticated"), encoding="utf-8")
    (out / "plan-authenticated.yaml").write_text(plan(routes, True, "zap-authenticated"), encoding="utf-8")


if __name__ == "__main__":
    main()
