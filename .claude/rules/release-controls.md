---
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
  - "vertex_be/deploy/**"
  - "docs/CI-CD-SETUP.md"
---

# CI/CD and release controls

- Treat the checked-in workflows as the operational release controls; read the relevant workflow and deployment documentation before proposing a change.
- The verified promotion rule is `dev` to `staging` automatically after CI, followed by a fast-forward promotion from `staging` to `main` only when the promotion workflow is manually dispatched from `staging`.
- Never promote directly from a feature branch. Do not replace fast-forward promotion with a merge or alter branch filters as a convenience.
- Production deployment is a separate manually dispatched workflow using the `prod-ops` runner. Promotion to `main` does not authorize production deployment.
- Never dispatch workflows, deploy, promote, or operate production without explicit user authorization. Do not bypass CI, guards, approvals, or verification.
- The deployment README documents intended procedures, but report any mismatch with workflow behavior instead of silently changing either source.
