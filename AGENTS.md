# Shared engineering guidance

This file is imported by the root `CLAUDE.md` so it also works with the installed Claude Code version, which predates native `AGENTS.md` loading.

## Source authority

- Follow `vertex/docs/SOURCE_AUTHORITY.md` for the project’s evidence hierarchy.
- Treat current source code and active configuration as evidence of technical behavior, not approval for business changes.
- The original SRS and platform recommendation were not found in the locations searched; their availability is unconfirmed. Never claim to have reviewed them or recreate their requirements from memory.
- Treat requirements not explicitly confirmed by the user as proposals. Call out assumptions and ask about material business ambiguity before implementing it.
- Preserve existing behavior and historical decisions unless the user confirms a change. Do not silently resolve a conflict by changing business logic.
- Prisma-specific guidance in historical files is not active architecture. The verified backend is FastAPI, SQLAlchemy, PostgreSQL, and Alembic.

## Change discipline

- Inspect the affected implementation and its existing patterns before editing.
- Make the smallest complete change. Avoid unrelated refactoring and preserve API contracts and business behavior.
- Do not edit generated files by hand when their source can be changed instead.
- Do not edit, expose, or copy `.env` files, credentials, access tokens, private keys, or test passwords into instructions, logs, or examples. Refer to secret names only when necessary; never print their values.
- Do not connect to databases, apply migrations, access production, or change deployment configuration unless the user explicitly authorizes that operation.
- Report changed files, verification performed, unresolved assumptions, and material risks.

## Git and release safety

- Do not switch branches, create or delete branches, commit, push, merge, or alter Git history without the user’s explicit authorization.
- Never promote a feature branch. The verified promotion path is `dev` to `staging` automatically after CI, then `staging` to `main` by manually dispatching the promotion workflow from `staging`; promotion is fast-forward only.
- Production deployment is separate from promotion and uses a manually dispatched workflow on the `prod-ops` runner. Never trigger a promotion, deployment, or production operation without explicit user authorization.
- Do not bypass CI, branch protections, workflow guards, or deployment verification. If workflow behavior and documentation disagree, report the discrepancy and follow the active workflow controls until the user resolves it.
- Ask before running tests or other commands that modify databases, external services, or shared state. For ordinary local code changes, run only the relevant checks requested or needed for the task and report exactly what ran.

## Checks and generated files

- The test scripts run against disposable containers they start and remove themselves, never a shared stack: `vertex_be/scripts/test.sh` (throwaway PostgreSQL), `vertex/scripts/test.sh` (throwaway object storage) and `vertex/scripts/test-e2e.sh` (Playwright journeys). Running them is not a database connection in the sense above. Run the journeys alone, without other suites in parallel.
- After changing a FastAPI route or schema, regenerate the contract rather than editing it by hand: `python scripts/export_openapi.py` in `vertex_be`, then `npm run api:types` in `vertex`. CI fails on a stale `openapi.json` or `api.generated.ts`.
- CI's security traceability gate (`tools/traceability.py`) requires every control and user story of the QA, Security & Implementation Guide to have a passing test. Backend tests declare theirs with `@pytest.mark.proves("SEC-…")`; Vitest and Playwright tests carry the ID in the test title. Keep these IDs when moving or renaming a test.

## Working in the monorepo

- Read the matching scoped rule in `.claude/rules/` before editing backend, web, mobile, security-sensitive, or release files.
- Keep schema ownership in the backend. The web and mobile clients consume backend APIs.
- Use focused read-only helper agents when they materially help with independent investigation or review; they are optional and must not perform deployment, database, or Git-release operations.
