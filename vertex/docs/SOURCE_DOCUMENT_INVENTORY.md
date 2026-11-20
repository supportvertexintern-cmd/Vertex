# Vertex source document inventory

**Checked:** 2026-11-17  
**Scope:** Files present in this workspace; prior exact-filename searches under `D:\Django Projects`, `D:\vertex`, and the current user's Desktop, Documents, and Downloads; and follow-up filename searches under `D:\collected Docs`, `D:\desktop`, `D:\projects`, `D:\backup`, and `D:\Vertex_preservation_backups` for documents with names containing Vertex, SRS, platform, or recommendation. External drives, cloud storage, email, and other computers have not been searched.

## Governing source documents named by `CLAUDE.md`

| Document | Purpose recorded in `CLAUDE.md` | Workspace status | Notes |
| --- | --- | --- | --- |
| [`PLATFORM_ARCHITECTURE.md`](PLATFORM_ARCHITECTURE.md) | Architecture and phased delivery plan; phase scope and exit checks | Present | Current project architecture reference. |
| `Vertex_SRS_Platform_Phases_1-5.docx` | Approved SRS; functional and non-functional requirements and phase acceptance criteria | Not found in locations searched; availability unconfirmed | `CLAUDE.md` points to `/Users/dunc/Desktop/Vertex/Vertex/…`, outside this Windows workspace. Exact-name and follow-up filename searches found no match in the locations listed above. The user clarified that not finding it there does not mean it is lost. Do not reconstruct requirements. |
| `Vertex platform recommendation.pdf` | Approved build/buy/integrate recommendation and gap analysis | Not found in locations searched; availability unconfirmed | `CLAUDE.md` points to `/Users/dunc/Desktop/Vertex/Vertex/…`, outside this Windows workspace. Exact-name and follow-up filename searches found no match in the locations listed above. The user clarified that not finding it there does not mean it is lost. Do not reconstruct decisions. |

The architecture document is the only one of these three governing sources found in this workspace. The SRS and recommendation have not been located in the searched folders; their availability is unconfirmed. Do not claim they were reviewed or reconstruct their contents. See [`SOURCE_AUTHORITY.md`](SOURCE_AUTHORITY.md) for how Claude should handle the limitation.

## Additional business source files referenced by project history

| Document | Referenced use | Workspace status | Notes |
| --- | --- | --- | --- |
| `Service and Pricing list.xlsx` | Original partner-facing programme/pricing source for the opportunities catalog | Not found | Superseded by the 2026 candidate pricing list below, according to `CLAUDE.md` and the architecture history. Its PDF version was explicitly not used as the source of truth. |
| `Vertex Service and Pricing List 2026 for Candidates.xlsx` | Revised candidate programme fees, tiers, and destinations | Not found | Current source named in project history for the 2026 pricing revision. |
| `Vertex_Supervisory_Reporting_Framework and Guideline.pdf` | Controlled internal reporting templates and framework, v1.0, July 2026 | Not found | Referenced in the architecture history as a business-supplied refinement. |

## Related project guidance in the workspace

| Document | Role |
| --- | --- |
| [`PRD.md`](PRD.md) | Product requirements document in the repository. Compare against the approved SRS before treating it as a replacement or equivalent. |
| [`PROJECT_GUIDE.md`](PROJECT_GUIDE.md) | Project orientation and working guidance. |
| [`ROLES_AND_PERMISSIONS_REVIEW.md`](ROLES_AND_PERMISSIONS_REVIEW.md) | Role and permission review/reference. |
| [`CPANEL_DEPLOYMENT.md`](CPANEL_DEPLOYMENT.md) | Historical deployment procedure/reference. Use active workflows and [`../vertex_be/deploy/README.md`](../../vertex_be/deploy/README.md) for current deployment and release controls. |
| [`../CLAUDE.md`](../CLAUDE.md) | Historical Claude Code instructions (Prisma era), including source references and recorded decisions. Excluded from loading by `.claude/settings.json`; the active instructions are the root `CLAUDE.md`, `AGENTS.md`, and `.claude/rules/`. It is not an approved replacement for the SRS. |
| [`../README.md`](../README.md) | Repository entry point. |

## User manuals in the workspace

These are operational manuals, not governing requirements sources:

- [`manuals/Finance_Portal_Manual.docx`](manuals/Finance_Portal_Manual.docx)
- [`manuals/HR_Portal_Manual.docx`](manuals/HR_Portal_Manual.docx)
- [`manuals/Operations_Portal_Manual.docx`](manuals/Operations_Portal_Manual.docx)
- [`manuals/Partner_Portal_Manual.docx`](manuals/Partner_Portal_Manual.docx)

## Inventory boundary and follow-up

The searched locations contained no copies matching the SRS or recommendation filenames or the follow-up filename patterns. This establishes only that they were not found in those locations; it does not establish that the originals are lost or unavailable elsewhere. External drives, cloud storage, email, and other computers have not been searched. The inventory does not establish whether the repository `PRD.md` is approved or whether any source has a newer version. Do not infer or recreate missing approved content.
