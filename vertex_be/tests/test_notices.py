"""The emails FastAPI leaves due (app/api/notices.py) are all sent by FastAPI
itself since reads handover R7b (app/services/emails.py): every kind has its
template and values, and the website no longer has senders of its own, so
no email is silently dropped or sent twice (owner's decisions D1, D4)."""

import typing

from app.api import notices
from app.core.config import BASE_DIR
from app.services.emails import SENT_HERE

PIPELINE_TS = (BASE_DIR.parent / "vertex" / "src" / "lib" / "pipeline.ts").read_text(encoding="utf-8")


def fastapi_kinds() -> set[str]:
    union = typing.get_args(notices.Notice)[0]
    return {model.model_fields["kind"].default for model in typing.get_args(union)}


def test_fastapi_sends_every_notice_and_the_website_none():
    assert fastapi_kinds() == SENT_HERE
    assert len(SENT_HERE) >= 27
    assert "NOTICE_SENDERS" not in PIPELINE_TS and "sendNotices" not in PIPELINE_TS
