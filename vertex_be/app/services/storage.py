"""Candidate documents in S3-compatible object storage: a port of
vertex/src/lib/upload.ts for the pipeline handover step 6.3 (owner's
decision D2: FastAPI handles uploads end to end).

One client, three kinds of backend, chosen by configuration alone, the
same variables as the website's:
  - MinIO (the local and self-hosted stacks): S3_ENDPOINT=http://minio:9000
  - AWS S3: no S3_ENDPOINT, S3_REGION set
  - Cloudflare R2: the legacy R2_* variables
Documents are never on local disk and never at a public URL: the website
serves them through its own token-gated route.

The browser's declared type is only a claim: the first bytes decide, and the
stored name's extension comes from them, never the user's filename.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from typing import Any, Literal

from app.core.clock import utc_now_ms
from app.core.config import settings
from app.core.logging import log_event
from app.services.malware_scan import scan_bytes

ALLOWED_MIME_TYPES = ("application/pdf", "image/jpeg", "image/jpg", "image/png")
TYPE_KEY = re.compile(r"^[a-z0-9_]{1,64}$")


class StorageNotConfigured(Exception):
    pass


class UploadRejected(Exception):
    """The file isn't acceptable; the message is for the user."""


class MalwareDetected(Exception):
    def __init__(self, signature: str) -> None:
        super().__init__("This file was rejected by the malware scanner.")
        self.signature = signature


@dataclass(frozen=True)
class StorageConfig:
    bucket: str
    region: str
    endpoint: str | None
    force_path_style: bool
    access_key_id: str
    secret_access_key: str


def resolve_storage_config(env: Any = settings) -> StorageConfig:
    """resolveStorageConfig: S3_* names win, R2_* are the fallback."""
    bucket = env.S3_BUCKET or env.R2_BUCKET_NAME
    access_key_id = env.S3_ACCESS_KEY_ID or env.R2_ACCESS_KEY_ID
    secret_access_key = env.S3_SECRET_ACCESS_KEY or env.R2_SECRET_ACCESS_KEY
    endpoint = env.S3_ENDPOINT or env.R2_ENDPOINT or (f"https://{env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com" if env.R2_ACCOUNT_ID else None)
    region = env.S3_REGION or ("us-east-1" if endpoint else None)
    if not (bucket and access_key_id and secret_access_key and region):
        raise StorageNotConfigured(
            "Document storage is not configured: set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and either S3_ENDPOINT (MinIO, R2) or S3_REGION (AWS S3)."
        )
    # MinIO serves buckets by path; AWS and R2 use their default addressing.
    return StorageConfig(bucket, region, endpoint, bool(env.S3_ENDPOINT or env.R2_ENDPOINT), access_key_id, secret_access_key)


@lru_cache
def _client(config: StorageConfig):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        region_name=config.region,
        endpoint_url=config.endpoint,
        aws_access_key_id=config.access_key_id,
        aws_secret_access_key=config.secret_access_key,
        config=Config(s3={"addressing_style": "path" if config.force_path_style else "auto"}, retries={"max_attempts": 3}),
    )


def max_file_size() -> int:
    return settings.MAX_FILE_SIZE_MB * 1024 * 1024


def detect_file_type(data: bytes) -> tuple[str, str] | None:
    """(mime, extension) from the magic numbers, or None."""
    if data.startswith(b"%PDF-"):
        return "application/pdf", "pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    return None


def _same_family(detected: str, declared: str) -> bool:
    def normalise(m: str) -> str:
        return "image/jpeg" if m == "image/jpg" else m

    return normalise(detected) == normalise(declared)


@dataclass(frozen=True)
class SavedDocument:
    storage_path: str
    # "unscanned" when the scanner couldn't be reached (fail-open).
    scan_status: Literal["clean", "unscanned"]
    scanned_at: datetime | None


def save_document(data: bytes, declared_type: str, document_type: str) -> SavedDocument:
    """saveUploadedDocument: checks, scans and stores the file. Raises
    UploadRejected, MalwareDetected or StorageNotConfigured."""
    if not TYPE_KEY.match(document_type):
        raise UploadRejected("Invalid document type.")
    if declared_type not in ALLOWED_MIME_TYPES:
        raise UploadRejected("Invalid file type. Only PDF, JPEG, and PNG are allowed.")
    if len(data) > max_file_size():
        raise UploadRejected(f"File too large. Maximum size is {settings.MAX_FILE_SIZE_MB}MB.")
    config = resolve_storage_config()

    # Scan everything that arrives, before any other judgement about it.
    scan = scan_bytes(data)
    if scan.status == "infected":
        raise MalwareDetected(scan.signature or "unknown")

    detected = detect_file_type(data)
    if detected is None or not _same_family(detected[0], declared_type):
        raise UploadRejected("File content does not match an allowed type (PDF, JPEG, PNG).")
    mime, ext = detected

    storage_path = f"{document_type}/{uuid.uuid4()}.{ext}"
    _client(config).put_object(Bucket=config.bucket, Key=storage_path, Body=data, ContentType=mime)
    clean = scan.status == "clean"
    return SavedDocument(storage_path, "clean" if clean else "unscanned", utc_now_ms() if clean else None)


def read_document(storage_path: str) -> bytes | None:
    """The stored bytes, or None if there's no such object."""
    config = resolve_storage_config()
    try:
        return _client(config).get_object(Bucket=config.bucket, Key=storage_path)["Body"].read()
    except Exception:  # noqa: BLE001  (missing object or unreachable store: not found, as upload.ts)
        return None


def delete_document(storage_path: str) -> None:
    """Best effort, as deleteUploadedFile: a failure is logged, not raised."""
    try:
        config = resolve_storage_config()
        _client(config).delete_object(Bucket=config.bucket, Key=storage_path)
    except Exception as err:  # noqa: BLE001
        log_event(logging.ERROR, "storage.delete_failed", storage_path=storage_path, error=type(err).__name__)
