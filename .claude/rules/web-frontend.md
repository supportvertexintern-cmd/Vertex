---
paths:
  - "vertex/src/**/*.{ts,tsx,js,jsx}"
  - "vertex/package.json"
  - "vertex/next.config.ts"
---

# Web frontend rules

- `vertex/` is the Next.js and React web client. Obtain application data through the FastAPI backend; do not add direct PostgreSQL or Prisma access to the website.
- Follow existing route, component, validation, session, API-client, and test patterns in the relevant area before editing.
- Preserve authorization boundaries in the backend. A hidden UI control is not an authorization check; server-side authorization remains decisive.
- Keep runtime and build-time configuration behavior consistent with the deployment documentation. Never expose server-only configuration to browser code.
- `vertex/CLAUDE.md` is an excluded historical document; do not revive its superseded Prisma or deployment instructions.
