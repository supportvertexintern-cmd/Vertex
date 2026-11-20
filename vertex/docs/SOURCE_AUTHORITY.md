# Vertex source authority register

**Status:** Approved project guidance, 2026-11-16.  
**Scope:** Establishes how Claude should resolve technical and business-source conflicts in this repository.

## Authority by subject

| Priority | Subject | Authoritative evidence | Treatment |
| --- | --- | --- | --- |
| 1 | Current technical behavior | Current application source and active configuration | Technical truth. Verify in the affected component; do not infer business approval from code alone. |
| 2 | Database schema and migrations | SQLAlchemy models and Alembic migration history in `vertex_be/` | Database truth. `vertex/docs/schema.sql` is a snapshot, not migration authority. |
| 3 | CI/CD and release controls | Checked-in GitHub workflow logic, corroborated with deployment documentation | Workflow logic governs execution. Report discrepancies; do not bypass controls. |
| 4 | Business requirements and decisions | Requirements explicitly confirmed by the user or an identified approved source | Business truth only within confirmed scope. Unconfirmed requirements remain proposals. |
| 5 | Operational procedures | Current operational documentation, including `vertex_be/deploy/README.md` | Procedure reference; verify against active configuration before operational action. |
| 6 | PRD and role review | `vertex/docs/PRD.md` and `vertex/docs/ROLES_AND_PERMISSIONS_REVIEW.md` | Reference only until approval and technical accuracy are independently confirmed. |
| 7 | Historical architecture and instructions | `vertex/docs/PLATFORM_ARCHITECTURE.md` and historical `vertex/CLAUDE.md` | Historical/reference material. Preserve useful decisions, but verify before treating any technical or business claim as current. |

## Verified architecture baseline

- **Web:** Next.js 16 and React 19 in `vertex/`.
- **Backend:** FastAPI and SQLAlchemy in `vertex_be/app/`, with PostgreSQL through the declared PostgreSQL driver.
- **Migrations:** Alembic in `vertex_be/alembic/versions/`, numbered in sequence; the latest file there is the current head.
- **Mobile:** Flutter and Dart in `vertex_app/`.
- **Database ownership:** The backend owns application database access and schema changes. The frontend has no verified Prisma client or direct database layer in the inspected source.
- **Prisma:** No active Prisma schema or client reference was found in the checked locations. Treat historical Prisma guidance as inactive unless current code provides contrary evidence.

## Verified release controls

- Pushes to `dev` start the promotion workflow; CI must succeed before its fast-forward promotion to `staging`.
- Promotion from `staging` to `main` requires manually dispatching the promotion workflow from `staging`, then passing CI and fast-forwarding.
- Feature branches are not promotion sources. Do not promote directly from them.
- Production deployment is separate from promotion to `main`; the inspected production workflow is manually dispatched and uses the `prod-ops` runner.
- Local deployment workflows may react to completed builds on `dev`, `staging`, or `main`. Their triggers do not authorize Claude to dispatch workflows or perform deployment operations.
- Never trigger promotion, deployment, or production operations without explicit user authorization.

These statements reflect repository workflow and deployment documentation inspected on 2026-11-16. Re-check the relevant workflow before any future release-control change.

## Unavailable and unverified sources

- **Original SRS — not found in the locations searched; availability is unconfirmed.** The user clarified that not finding it under the searched filenames and locations does not mean it is lost. Do not claim it was reviewed or recreate its requirements.
- **Platform recommendation PDF — not found in the locations searched; availability is unconfirmed.** The user clarified that not finding it under the searched filenames and locations does not mean it is lost. Do not claim it was reviewed or reconstruct its build/buy decisions.
- Pricing workbooks and the supervisory reporting framework are referenced in project history but were not found in this workspace. Their status is “not found here,” not confirmed unavailable.
- `vertex/docs/PRD.md` exists, but its approval status is unconfirmed and its Prisma-era technical claims conflict with the verified current architecture.
- `vertex/docs/ROLES_AND_PERMISSIONS_REVIEW.md` exists, but its Prisma-based evidence needs revalidation against the FastAPI backend.

## Conflict handling

When documents or implementation disagree:

1. Identify the affected files and what each actually establishes.
2. Use current code/configuration for technical behavior and verified workflows for CI/CD behavior.
3. Do not silently alter business rules to make the implementation match a document.
4. Mark assumptions and ask the user about material business decisions.
5. Preserve historical records unless the user explicitly requests a change.
