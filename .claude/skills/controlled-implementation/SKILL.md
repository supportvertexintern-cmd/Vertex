---
name: controlled-implementation
description: Implement an approved Vertex change using the existing architecture and minimal scope when the user explicitly invokes this workflow.
user-invocable: true
disable-model-invocation: true
---

# Controlled implementation workflow

Use this workflow only when the user invokes `/controlled-implementation` or explicitly asks to use it.

1. Confirm the approved scope and acceptance criteria from the conversation and current repository. Do not invent missing business requirements.
2. Inspect the relevant implementation, tests, scoped Claude rules, and authority documents before editing.
3. Make the smallest complete change that fits existing architecture and conventions. Avoid unrelated refactoring and preserve API contracts and business logic.
4. Do not change branches, commit, push, merge, promote, dispatch workflows, deploy, connect to databases, or apply migrations without explicit authorization.
5. Do not read or expose secret values. Keep generated code changes in their source-of-truth files.
6. Run only relevant checks that the user requested or that are necessary for the approved implementation; report exact commands and results. Never claim a check passed unless it ran.
7. Summarize changed files, behavior, verification, assumptions, and unresolved risks.
