"""Document writes for the pipeline handover, step 6.3
(docs/architecture/pipeline-handover.md): uploads end to end (owner's
decision D2: the file is checked, scanned and stored here, then its row is
written), verification, and the scan a document gets when it's next opened.

Built ahead of the switch (D3 B): every route answers 503 until
PIPELINE_WRITES_ENABLED is set at step 6.7, when Next.js's POST /api/upload
and PATCH /api/documents/[id]/verify start passing requests on, and its
document-reading routes ask /documents/readable before serving a file.

They answer as those routes do: the same roles (tests fail if the lists
drift), access rules (app/core/scope.py), checks, messages and status codes.

Three callers can upload:
  - a signed-in user: a candidate for themself; staff, partners, HR,
    operations or finance for a candidate they can reach (candidate_id);
    a partner, or HR and operations on its behalf, to a draft submission
    (partner_candidate_id);
  - the Candidate Information Form, before any account exists: Next.js
    calls /documents/form-upload as itself with the form's upload token,
    which FastAPI verifies.

A re-upload of a type replaces the earlier file, except "other", which may
repeat (each with its own label). The replaced file is deleted only once the
new row has committed, and a stored file whose row fails is removed.

Every change is on the audit trail (Document and Candidate are in
AUDITED_MODELS); a malware rejection is a security event.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import DbSession
from app.core.api import ApiError, Data, UtcDateTime
from app.core.audit import AuditedDb, record_security_event, set_audit_actor
from app.core.auth import AuthUser, CurrentUser, OptionalUser, calling_service
from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.pipeline import PipelineWrites
from app.core.rbac import STAFF_ROLES, require_role
from app.core.scope import CandidateRef, can_access_candidate, can_access_document
from app.core.tokens import InvalidToken, verify_cif_upload_token
from app.models.candidate import Candidate, Document
from app.models.enums import CandidateLifecycleStatus, PartnerCandidateStatus, Role, VerificationStatus
from app.models.partners import Partner, PartnerCandidate
from app.models.reference import DocumentRequirementType
from app.services import storage
from app.services.documents import document_completeness
from app.services.malware_scan import scan_bytes

router = APIRouter()

# Uploading for a candidate other than yourself: the staff hierarchy, and
# partners, operations, finance and HR, each still limited to the
# candidates they can reach. None of the latter are staff roles.
ON_BEHALF_UPLOADERS: frozenset[Role] = STAFF_ROLES | {
    Role.partner,
    Role.operations_team,
    Role.operations_director,
    Role.finance,
    Role.hr,
}
# Staff entering a partner's backlog for it may attach files to any draft.
DRAFT_STAFF: frozenset[Role] = frozenset({Role.hr, Role.operations_team, Role.operations_director, Role.admin})
# Verification: supervisors for the recruiter pipeline (never the sourcing
# recruiter), HR for partner submissions.
VERIFIERS: tuple[Role, ...] = (Role.country_supervisor, Role.inhouse_supervisor, Role.director, Role.admin, Role.hr)
REPEATABLE_TYPE = "other"
UPLOAD_TOKEN_HEADER = "X-Upload-Token"
# Room for the multipart framing and the label around the file itself.
FORM_OVERHEAD = 64 * 1024


def _now() -> datetime:
    return utc_now_ms()


class DocumentRow(BaseModel):
    """Every column, as Prisma returns a document row."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    candidate_id: str | None
    partner_candidate_id: str | None
    type: str
    storage_path: str
    verification_status: VerificationStatus
    verified_by: str | None
    verified_at: UtcDateTime | None
    uploaded_at: UtcDateTime
    label: str | None
    scan_status: str
    scanned_at: UtcDateTime | None


class VerifyIn(BaseModel):
    verification_status: Literal["verified", "rejected"]


class ReadableIn(BaseModel):
    storage_path: str


class Readable(BaseModel):
    scan_status: str | None  # None: not a candidate document


# --- uploading ---------------------------------------------------------------


class _Upload:
    """The parts of the multipart request: the file and its label."""

    def __init__(self, data: bytes, content_type: str, label: str | None) -> None:
        self.data = data
        self.content_type = content_type
        self.label = label


async def _read_upload(request: Request) -> _Upload:
    limit = storage.max_file_size()
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + FORM_OVERHEAD:
        raise ApiError(400, "upload_rejected", f"File too large. Maximum size is {settings.MAX_FILE_SIZE_MB}MB.")
    try:
        form = await request.form(max_files=1, max_fields=4)
    except Exception:  # noqa: BLE001  (not multipart, or malformed)
        raise ApiError(400, "invalid_form", "Invalid form data.") from None
    file = form.get("file")
    if file is None or isinstance(file, str):
        raise ApiError(400, "no_file", "No file uploaded.")
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise ApiError(400, "upload_rejected", f"File too large. Maximum size is {settings.MAX_FILE_SIZE_MB}MB.")
    label = form.get("label")
    # Only meaningful for "other": says what the supporting document is.
    label = label.strip() or None if isinstance(label, str) else None
    return _Upload(data, file.content_type or "", label)


def _known_type(db: Session, document_type: str | None) -> str:
    if not document_type or db.scalar(select(DocumentRequirementType.id).where(DocumentRequirementType.key == document_type)) is None:
        raise ApiError(400, "invalid_type", "Query param 'type' must be a known document requirement type.")
    return document_type


def _store(upload: _Upload, document_type: str, actor_id: str | None, entity_type: str, entity_id: str) -> storage.SavedDocument:
    try:
        return storage.save_document(upload.data, upload.content_type, document_type)
    except storage.MalwareDetected as err:
        # Never stored. Record who, what and which signature: not the file.
        record_security_event(
            "malware_rejected",
            actor_id=actor_id,
            entity_type=entity_type,
            entity_id=entity_id,
            detail={"signature": err.signature, "document_type": document_type},
        )
        # The signature lets the website raise its malware alert.
        raise ApiError(422, "malware_detected", str(err), {"signature": err.signature}) from None
    except storage.UploadRejected as err:
        raise ApiError(400, "upload_rejected", str(err)) from None
    except storage.StorageNotConfigured:
        raise ApiError(503, "storage_unavailable", "Document storage is unavailable. Please try again later.") from None


def _file(db: Session, upload: _Upload, document_type: str, saved: storage.SavedDocument, owner: dict[str, str]) -> Document:
    """Writes the row, replacing an earlier one of the type, and commits.
    The earlier file goes once the new row is in; the new file goes if it
    isn't."""
    replaced_path: str | None = None
    if document_type != REPEATABLE_TYPE:
        [(column, owner_id)] = owner.items()
        replaced = db.scalar(select(Document).where(getattr(Document, column) == owner_id, Document.type == document_type))
        if replaced is not None:
            replaced_path = replaced.storage_path
            db.delete(replaced)
    document = Document(
        **owner,
        type=document_type,
        storage_path=saved.storage_path,
        label=upload.label,
        scan_status=saved.scan_status,
        scanned_at=saved.scanned_at,
    )
    db.add(document)
    try:
        db.flush()
        if "candidate_id" in owner:
            _submit_if_complete(db, owner["candidate_id"])
        db.commit()
    except Exception:
        db.rollback()
        storage.delete_document(saved.storage_path)
        raise
    if replaced_path is not None:
        storage.delete_document(replaced_path)
    db.refresh(document)
    return document


def _submit_if_complete(db: Session, candidate_id: str) -> None:
    """Uploading the last required document is what "submitted" means; only
    from guided_to_apply, so a candidate further along is left alone."""
    candidate = db.get(Candidate, candidate_id)
    if candidate.lifecycle_status is CandidateLifecycleStatus.guided_to_apply and document_completeness(db, candidate_id).complete:
        candidate.lifecycle_status = CandidateLifecycleStatus.submitted


def _upload_to_draft(db: Session, user: AuthUser, draft_id: str, document_type: str, upload: _Upload) -> Document:
    if user.role is not Role.partner and user.role not in DRAFT_STAFF:
        raise ApiError(403, "forbidden", "Only the owning partner or HR/Operations can upload to a draft.")
    draft = db.get(PartnerCandidate, draft_id)
    own_partner = None if user.role in DRAFT_STAFF else db.scalar(select(Partner.id).where(Partner.user_id == user.user_id))
    if draft is None or (user.role not in DRAFT_STAFF and draft.partner_id != own_partner):
        raise ApiError(404, "not_found", "Draft not found.")
    if draft.status is not PartnerCandidateStatus.draft:
        raise ApiError(409, "not_a_draft", "This submission is no longer a draft — upload against its candidate_id instead.")
    saved = _store(upload, document_type, user.user_id, "PartnerCandidate", draft.id)
    return _file(db, upload, document_type, saved, {"partner_candidate_id": draft.id})


def _upload_for_user(db: Session, user: AuthUser, candidate_id: str | None, document_type: str, upload: _Upload) -> Document:
    if candidate_id:
        if user.role not in ON_BEHALF_UPLOADERS:
            raise ApiError(403, "forbidden", "Only staff can upload on behalf of a candidate.")
        candidate = db.get(Candidate, candidate_id)
        if candidate is None:
            raise ApiError(404, "not_found", "Candidate not found.")
        if not can_access_candidate(db, user, CandidateRef.of(candidate)):
            raise ApiError(403, "forbidden", "Forbidden.")
    else:
        candidate = db.scalar(select(Candidate).where(Candidate.user_id == user.user_id))
        if candidate is None:
            raise ApiError(404, "not_found", "Candidate profile not found.")
    saved = _store(upload, document_type, user.user_id, "Candidate", candidate.id)
    return _file(db, upload, document_type, saved, {"candidate_id": candidate.id})


@router.post("/documents", response_model=Data[DocumentRow])
async def upload(
    request: Request,
    user: CurrentUser,
    db: AuditedDb,
    _on: PipelineWrites,
    document_type: Annotated[str | None, Query(alias="type")] = None,
    candidate_id: str | None = None,
    partner_candidate_id: str | None = None,
):
    """POST /api/upload?type=<key>[&candidate_id=|&partner_candidate_id=],
    multipart: file, and label for type "other"."""
    document_type = await run_in_threadpool(_known_type, db, document_type)
    upload = await _read_upload(request)
    if partner_candidate_id:
        document = await run_in_threadpool(_upload_to_draft, db, user, partner_candidate_id, document_type, upload)
    else:
        document = await run_in_threadpool(_upload_for_user, db, user, candidate_id, document_type, upload)
    return {"data": document}


def _upload_from_form(db: Session, token: str | None, candidate_id: str, document_type: str, upload: _Upload) -> Document:
    try:
        token_candidate = verify_cif_upload_token(token or "")
    except InvalidToken:
        raise ApiError(401, "upload_token_expired", "This upload link has expired. Please refresh and resubmit the form.") from None
    if token_candidate != candidate_id:
        raise ApiError(403, "forbidden", "Forbidden.")
    candidate = db.get(Candidate, candidate_id)
    if candidate is None:
        raise ApiError(404, "not_found", "Candidate profile not found.")
    saved = _store(upload, document_type, None, "Candidate", candidate.id)
    return _file(db, upload, document_type, saved, {"candidate_id": candidate.id})


@router.post("/documents/form-upload", response_model=Data[DocumentRow], dependencies=[Depends(calling_service)])
async def upload_from_form(
    request: Request,
    db: DbSession,
    _on: PipelineWrites,
    candidate_id: str,
    document_type: Annotated[str | None, Query(alias="type")] = None,
):
    """POST /api/upload with X-Upload-Token: a self-applicant attaching
    documents to the form they have just submitted, before any account
    exists. Only Next.js may call this; the token decides the candidate."""
    set_audit_actor(db, None)  # no signed-in actor, as a fresh self-registration
    document_type = await run_in_threadpool(_known_type, db, document_type)
    upload = await _read_upload(request)
    token = request.headers.get(UPLOAD_TOKEN_HEADER)
    document = await run_in_threadpool(_upload_from_form, db, token, candidate_id, document_type, upload)
    return {"data": document}


# --- verification ------------------------------------------------------------


@router.patch("/documents/{document_id}/verify", response_model=Data[DocumentRow])
def verify(
    document_id: str,
    body: VerifyIn,
    user: Annotated[AuthUser, Depends(require_role(*VERIFIERS))],
    db: AuditedDb,
    _on: PipelineWrites,
):
    """PATCH /api/documents/[id]/verify (SRS FR-2.7). Rejecting a partner
    submission's document doesn't touch the submission's status: the partner
    replaces the file."""
    document = db.get(Document, document_id)
    if document is None:
        raise ApiError(404, "not_found", "Document not found.")
    candidate = CandidateRef.of(document.candidate) if document.candidate else None
    if not can_access_document(db, user, candidate, document.partner_candidate_id):
        raise ApiError(403, "forbidden", "Forbidden.")
    document.verification_status = VerificationStatus(body.verification_status)
    document.verified_by = user.user_id
    document.verified_at = _now()
    db.commit()
    db.refresh(document)
    return {"data": document}


# --- opening a document ------------------------------------------------------


@router.post("/documents/readable", response_model=Data[Readable], dependencies=[Depends(calling_service)])
def readable(body: ReadableIn, user: OptionalUser, db: DbSession, _on: PipelineWrites):
    """assertDocumentReadable: Next.js asks before a stored file leaves the
    server (a download, an email attachment), for a user or for itself.
    Uploads are scanned before storage; this catches those accepted while
    the scanner was unreachable, scanning them now. Infected is always
    refused; unscanned and still unreachable is served (fail-open)."""
    set_audit_actor(db, user.user_id if user else None)
    document = db.scalar(select(Document).where(Document.storage_path == body.storage_path))
    if document is None:
        return {"data": {"scan_status": None}}  # not a candidate document
    found: str | None = None  # the signature, when this scan found it
    if document.scan_status == "unscanned":
        data = storage.read_document(document.storage_path)
        result = scan_bytes(data) if data is not None else None
        if result is not None and result.status != "unavailable":
            document.scan_status = result.status
            document.scanned_at = _now()
            db.commit()
            if result.status == "infected":
                found = result.signature
                record_security_event(
                    "malware_blocked_download",
                    actor_id=user.user_id if user else None,
                    entity_type="Document",
                    entity_id=document.id,
                    detail={"signature": result.signature},
                )
    if document.scan_status == "infected":
        # newly_found: the website alerts on a discovery, not on every refusal.
        details = {"document_id": document.id, "newly_found": found is not None, "signature": found}
        raise ApiError(403, "document_blocked", "This document is blocked: it failed a malware scan.", details)
    return {"data": {"scan_status": document.scan_status}}
