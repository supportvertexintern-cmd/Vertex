---
name: requirements-engineering
description: Prepare a requirements specification or impact analysis when the user explicitly invokes this workflow.
user-invocable: true
disable-model-invocation: true
---

# Requirements engineering workflow

Use this workflow only when the user invokes `/requirements-engineering` or explicitly asks to use it.

1. Restate the business problem and desired outcome in the user's terms.
2. Inspect relevant existing code and current documentation before proposing changes. Use `vertex/docs/SOURCE_AUTHORITY.md` to assess authority.
3. Separate confirmed requirements, existing behavior, assumptions, and open questions. The original SRS and platform recommendation are unavailable; never claim to have reviewed or reconstruct them.
4. Identify affected components, API contracts, authorization, data ownership, migrations, integrations, deployment implications, and compatibility concerns.
5. Define acceptance criteria that can be checked without inventing business policy.
6. Present a scoped implementation plan and material risks. Mark every unconfirmed business decision as a proposal.
7. Stop before implementation and request user approval when the user asked for a specification only or when material business decisions remain unresolved.

Do not edit files as part of a specification-only request. Do not connect to production or a database.
