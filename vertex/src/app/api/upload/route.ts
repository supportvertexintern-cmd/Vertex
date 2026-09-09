import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma, auditSecurityEvent } from "@/lib/audit";
import { deleteUploadedFile, saveUploadedDocument, MalwareDetectedError } from "@/lib/upload";
import { getAuthUser, requireAuth, forbidden } from "@/lib/api-auth";
import { canAccessCandidate } from "@/server/scope";
import { isStaffRole } from "@/lib/rbac";
import { verifyCifUploadToken } from "@/lib/jwt";
import { evaluateDocumentCompletenessForCandidateId } from "@/server/services/documentCompleteness";

// POST /api/upload?type=<key>[&candidate_id=...]
// `type` is validated against the admin-managed DocumentRequirementType
// table (SRS FR-4.6's mobility-lifecycle set plus the Candidate
// Information Form's Section 3 checklist) rather than a fixed allowlist,
// so a type admin adds from the UI is immediately uploadable.
// Self-upload (no candidate_id) covers a candidate managing their own
// account. A recruiter/supervisor/admin passing candidate_id uploads on
// behalf of a recruiter-sourced lead who has no account yet (SRS FR-2.1,
// FR-2.5) — common in the field, where the recruiter is the one who
// physically collects and scans the candidate's documents. An
// `X-Upload-Token` header (2026-08-06) covers the third case: an
// anonymous self-applicant attaching real documents inline on the CIF,
// moments after it creates their Candidate row — before any session or
// User account exists at all, so neither of the above paths apply.
export async function POST(req: NextRequest) {
  const fileType = req.nextUrl.searchParams.get("type");
  if (!fileType || !(await prisma.documentRequirementType.findUnique({ where: { key: fileType } }))) {
    return NextResponse.json(
      { error: "Query param 'type' must be a known document requirement type." },
      { status: 400 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  // Only meaningful for type "other" (2026-08-05) — a free-text reference
  // so a partner/candidate/recruiter attaching a supporting document that
  // isn't one of the fixed required types can say what it actually is,
  // since "Other Document" alone can't distinguish two of them.
  const label = (formData.get("label") as string | null)?.trim() || null;

  const targetCandidateId = req.nextUrl.searchParams.get("candidate_id");
  const targetPartnerCandidateId = req.nextUrl.searchParams.get("partner_candidate_id");
  const cifUploadToken = req.headers.get("X-Upload-Token");

  // A partner attaching a real file to their own still-in-progress draft
  // (2026-09-09) — no real Candidate exists yet to file it under (that
  // only gets created at final submission), so the Document is filed
  // directly against the PartnerCandidate row instead and reparented onto
  // the real Candidate once the draft is finalized (see
  // finalizeSubmission()). Handled as its own early branch, distinct from
  // every other target-resolution path below, since none of those resolve
  // to a Candidate at all.
  if (targetPartnerCandidateId) {
    const user = await getAuthUser(req);
    const guardRes = requireAuth(user);
    if (guardRes) return guardRes;
    if (user!.role !== "partner") {
      return NextResponse.json({ error: "Only the owning partner can upload to a draft." }, { status: 403 });
    }
    const partner = await prisma.partner.findUnique({ where: { user_id: user!.userId } });
    const partnerCandidate = await prisma.partnerCandidate.findUnique({ where: { id: targetPartnerCandidateId } });
    if (!partnerCandidate || !partner || partnerCandidate.partner_id !== partner.id) {
      return NextResponse.json({ error: "Draft not found." }, { status: 404 });
    }
    if (partnerCandidate.status !== "draft") {
      // Once submitted/bridged, uploads go through the normal
      // candidate_id=bridged_candidate_id path instead — same as the
      // existing "partner uploads on behalf of a candidate it just
      // bridged" branch further down.
      return NextResponse.json({ error: "This submission is no longer a draft — upload against its candidate_id instead." }, { status: 409 });
    }

    let storagePath: string;
    try {
      storagePath = await saveUploadedFile(file, fileType);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const db = auditedPrisma(user!.userId);

    if (fileType !== "other") {
      const existing = await prisma.document.findFirst({
        where: { partner_candidate_id: partnerCandidate.id, type: fileType },
      });
      if (existing) {
        await deleteUploadedFile(existing.storage_path);
        await db.document.delete({ where: { id: existing.id } });
      }
    }

    const document = await db.document.create({
      data: {
        partner_candidate_id: partnerCandidate.id,
        type: fileType,
        storage_path: storagePath,
        label,
      },
    });

    return NextResponse.json({ documentId: document.id, message: "File uploaded successfully." });
  }

  let candidate: { id: string; lifecycle_status: string } | null;
  let actorId: string | null;

  if (cifUploadToken && targetCandidateId) {
    let payload: ReturnType<typeof verifyCifUploadToken>;
    try {
      payload = verifyCifUploadToken(cifUploadToken);
    } catch {
      return NextResponse.json({ error: "This upload link has expired. Please refresh and resubmit the form." }, { status: 401 });
    }
    if (payload.type !== "cif_upload" || payload.candidateId !== targetCandidateId) {
      return forbidden({ error: "Forbidden." });
    }
    candidate = await prisma.candidate.findUnique({
      where: { id: targetCandidateId },
      select: { id: true, lifecycle_status: true },
    });
    actorId = null; // no authenticated actor — same as a fresh self-registration
  } else {
    const user = await getAuthUser(req);
    const guardRes = requireAuth(user);
    if (guardRes) return guardRes;
    actorId = user!.userId;

    if (targetCandidateId) {
      // A partner may also upload on behalf of a candidate it just bridged
      // (2026-07-27) — real document uploads at partner-submission time,
      // scoped below by canAccessCandidate to only that partner's own
      // candidates, same as a recruiter is scoped to their own sourced leads.
      // Operations can also upload here (2026-07-31) — this is how an issued
      // work permit/visa gets delivered back onto a case's document list.
      // Finance too (2026-07-31) — this is how a manually-recorded payment's
      // receipt gets attached for a partner/recruiter-sourced candidate, who
      // has no self-service upload path of their own for it. HR (2026-08-04)
      // — reviewing self-applications and partner submissions pre-Case, same
      // "save time on minor corrections" reasoning as the PATCH edit route.
      // None of these are folded into isStaffRole/STAFF_ROLES, same
      // reasoning as partner.
      const canUploadOnBehalf =
        isStaffRole(user!.role) ||
        user!.role === "partner" ||
        user!.role === "operations_team" ||
        user!.role === "operations_director" ||
        user!.role === "finance" ||
        user!.role === "hr";
      if (!canUploadOnBehalf) {
        return forbidden({ error: "Only staff can upload on behalf of a candidate." });
      }
      const full = await prisma.candidate.findUnique({
        where: { id: targetCandidateId },
        select: { id: true, user_id: true, recruiter_id: true, country_id: true, partner_id: true, lifecycle_status: true },
      });
      if (!full) {
        return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
      }
      if (!(await canAccessCandidate(user!, full))) {
        return forbidden({ error: "Forbidden." });
      }
      candidate = full;
    } else {
      candidate = await prisma.candidate.findUnique({
        where: { user_id: user!.userId },
        select: { id: true, lifecycle_status: true },
      });
    }
  }

  if (!candidate) {
    return NextResponse.json({ error: "Candidate profile not found." }, { status: 404 });
  }

  let saved: Awaited<ReturnType<typeof saveUploadedDocument>>;
  try {
    saved = await saveUploadedDocument(file, fileType);
  } catch (err: unknown) {
    if (err instanceof MalwareDetectedError) {
      // Never stored. Record who, which candidate, which signature: not the file.
      await auditSecurityEvent(actorId, "Candidate", candidate.id, "malware_rejected", {
        signature: err.signature,
        document_type: fileType,
      });
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const storagePath = saved.storagePath;

  const db = auditedPrisma(actorId);

  // A re-upload of the same document type supersedes the previous one —
  // except "other" (2026-08-05), which is allowed to accumulate multiple
  // rows per candidate (each with its own label) since it's the generic
  // bucket for whatever supporting documents don't fit the fixed types.
  if (fileType !== "other") {
    const existing = await prisma.document.findFirst({
      where: { candidate_id: candidate.id, type: fileType },
    });
    if (existing) {
      await deleteUploadedFile(existing.storage_path);
      await db.document.delete({ where: { id: existing.id } });
    }
  }

  const document = await db.document.create({
    data: {
      candidate_id: candidate.id,
      type: fileType,
      storage_path: storagePath,
      label,
      scan_status: saved.scanStatus,
      scanned_at: saved.scannedAt,
    },
  });

  // "Submitted" now means the candidate's required documents are all in
  // (they already submitted the Candidate Information Form itself at
  // "identified", long before any account or document existed) — this is
  // the system-only trigger candidateLifecycle.ts expects, so only fires
  // from guided_to_apply, never clobbering a candidate already further along.
  if (candidate.lifecycle_status === "guided_to_apply") {
    const completeness = await evaluateDocumentCompletenessForCandidateId(candidate.id);
    if (completeness.complete) {
      await db.candidate.update({ where: { id: candidate.id }, data: { lifecycle_status: "submitted" } });
    }
  }

  return NextResponse.json({ documentId: document.id, message: "File uploaded successfully." });
}
