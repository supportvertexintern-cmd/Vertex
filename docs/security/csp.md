# Content Security Policy with per-request nonces (exception E3)

Before this change, the CSP (Phase 8) allowed `'unsafe-inline'` for scripts, so it was no backstop against injected script. Now every page gets a fresh nonce, and only scripts that carry it, or that such a script added, may run.

## 1. How it works

`src/proxy.ts` runs on every page and API request (static assets excluded). For each page it:
1. creates a nonce: 128 bits from the platform CSPRNG, base64, new for every response;
2. sets the policy on the response (`lib/csp.ts`);
3. passes the policy and nonce to Next.js as request headers. Next.js 16 reads the nonce from them and puts it on every script it renders. The root layout passes it to the one `next/script` it renders.

A client-sent CSP or nonce header is always replaced, so a visitor can't choose the nonce. Reading the nonce in the root layout makes every page render per request, which nonces require: a page built ahead of time would have none.

**Policy (target):**

```
default-src 'self';
script-src 'nonce-{random}' 'strict-dynamic' 'self' https:;
style-src 'self' 'unsafe-inline' https://www.gstatic.com https://translate.googleapis.com https://assets.calendly.com;
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self' https://translate.googleapis.com https://translate-pa.googleapis.com;
frame-src https://calendly.com https://*.calendly.com https://translate.google.com;
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';
upgrade-insecure-requests;            (only behind HTTPS)
report-uri /api/csp-report;
report-to csp-endpoint                (only behind HTTPS, with Reporting-Endpoints)
```

Notes on the policy:
- `'self' https:` in `script-src` is only a fallback for browsers without `'strict-dynamic'`. Browsers that support it ignore both.
- `next dev` adds `'unsafe-eval'`. Production builds never do.
- API responses keep the previous fixed policy.

**Modes** (runtime env `CSP_MODE`, read on every request, so no rebuild is needed):

| `CSP_MODE` | Sent |
|---|---|
| unset / `report-only` (**default**) | Enforced: the previous policy (inline scripts still allowed). Report-only: the nonce policy above. |
| `enforce` | Enforced: the nonce policy, with reporting kept on |

**Where each header comes from.** `next.config.ts` sets the previous policy as a static baseline on every response, including the API and static files. In report-only mode the proxy adds only the report-only header. In enforce mode the proxy's nonce policy replaces the baseline on pages.

The proxy must never set the enforced header in report-only mode. Next.js copies a proxy's response headers into the request (`resolve-routes.js`), so a nonce-less enforced header would replace the nonce'd request header, and no script would get a nonce. The browser smoke test found this; `csp.test.ts` pins it.

**`report-to` only behind HTTPS.** When `report-to` is present, Chromium ignores `report-uri`, and over plain HTTP it delivered no reports at all. That was tested on 2026-10-12. So the local HTTP stacks use `report-uri` alone, and HTTPS deployments send both.

## 2. Inventory of inline code (step 1) and what changed (step 2)

| Item | Page | Change |
|---|---|---|
| Inline `<Script>` defining `googleTranslateElementInit` | every page (`app/layout.tsx`) | Moved to `public/js/google-translate.js`. It defines the callback, then loads Google's script, so the order is guaranteed. |
| `next/script` loading Google Translate | every page | Loaded by the file above. Trusted through `'strict-dynamic'`. |
| `next/script` loading Calendly's widget | `/consultation/confirmed` (`CalendlyEmbed`) | Unchanged. It is added by Next.js's nonce'd runtime, so it is trusted through `'strict-dynamic'`. |
| Inline `<style>` with keyframes | loading screen (`app/loading.tsx`) | Moved to `globals.css` |
| Next.js's own inline bootstrap and chunks | every page | Nonce applied by Next.js |
| `javascript:` URLs, `on*="…"` attributes, `eval` / `new Function` | none found | n/a |
| `style={{…}}` attributes (27) | various | Kept. `style-src` keeps `'unsafe-inline'` (step 7, follow-up). |

## 3. Reports (steps 5–6)

Browsers post violations to `POST /api/csp-report`. Both report formats are accepted.

The endpoint is public, rate-limited and capped at 16 KB. It keeps only these fields, each clipped:
- directive;
- blocked URL and page, with query strings removed;
- source file, line, disposition;
- a 40-character sample.

Reports are logged as `csp.violation`, and never written to the audit trail.

To watch the reports on a stack:

```sh
docker logs --since 24h vertex-staging-nextjs-1 2>&1 | grep '"csp.violation"' \
  | python -c "import sys,json,collections; c=collections.Counter((j.get('directive'),j.get('blocked'),j.get('page')) for j in map(json.loads,sys.stdin)); [print(n,*k) for k,n in c.most_common(30)]"
```

Fix each real violation at its source. Ignore reports from browser extensions: their `source` is `chrome-extension://…`, `moz-extension://…` and the like.

## 4. Rollout

1. **Now:** deploy with the default (report-only) to dev and staging, then main after approval. **Report-only began on staging and dev on 2026-10-13** (deploy of `a378352`). Enforce on staging from 2026-10-20 if the reports are clean; **due 2026-11-09 at the latest**.
2. **1–2 weeks:** watch the reports (§3). Exit criterion: no violations from the app's own pages.
3. **Enforce:** set `CSP_MODE=enforce` in the stack's env file and redeploy. Reporting stays on. Do staging first, then main. This closes E3.
4. **Follow-up:** `style-src 'unsafe-inline'`. Move the 27 style attributes to classes, then drop it.

Rollback at any time: remove `CSP_MODE` (or set it to `report-only`) and redeploy.

## 5. Regression check (step 9)

`vertex/src/lib/csp.test.ts` runs in CI. It fails if:
- `script-src` in the nonce policy, in either mode, contains `'unsafe-inline'` or `'unsafe-eval'`, or loses its nonce or `'strict-dynamic'`;
- the nonce isn't 128 bits, repeats, or can be set by the client;
- any page source gains a raw `<script>`, `dangerouslySetInnerHTML`, an inline `<Script>` body, a `javascript:` URL or a string event handler;
- the report endpoint stops stripping query strings, or errors on junk.

`dast-fixes.test.ts` checks that the enforced policy keeps the Phase 8 directives in both modes.

## 6. Evidence

| Date | What | Result |
|---|---|---|
| 2026-10-12 | Unit tests (`csp.test.ts`, `dast-fixes.test.ts`, route guards) | 26 passed |
| 2026-10-12 | Local production build (`next build` + `next start`), real Chromium (Playwright), throwaway database, both modes | **31/31 checks in each mode** (details below) |

What the Chromium run checked, in both modes:
- 8 public pages and the admin users page load with **no CSP violations**;
- all 14 server-rendered `<script>` tags carry the nonce. The only scripts without one are the two that Google Translate adds at runtime, which `'strict-dynamic'` trusts;
- sign-in through the UI works, which proves React hydrated;
- an injected `<img onerror=…>` (an HTML-injection payload) is **blocked in enforce mode**, still runs in report-only mode, and in both modes is reported: one `csp.violation` line in the server log, query string stripped.

The same run checked E6 end to end:
- cookie flags;
- the 15-minute access cookie;
- silent refresh on page navigation and on API calls;
- refresh-token rotation;
- a replayed spent token refused;
- log out everywhere.

Two bugs found and fixed by this run:
- the report-only nonce bug (§1);
- `report-to` suppressing reports on HTTP.

**Cost.** Every page now renders per request (no static prerendering). The pages already fetch their data on the client, so the extra server work is small.
