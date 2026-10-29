"""The emails FastAPI leaves due (app/api/notices.py) are the ones the website
knows how to send (NOTICE_SENDERS in vertex/src/lib/pipeline.ts), kind for
kind, so no email is silently dropped (owner's decision D1)."""

import re
import typing

from app.api import notices
from app.core.config import BASE_DIR

PIPELINE_TS = (BASE_DIR.parent / "vertex" / "src" / "lib" / "pipeline.ts").read_text(encoding="utf-8")


def fastapi_kinds() -> set[str]:
    union = typing.get_args(notices.Notice)[0]
    return {model.model_fields["kind"].default for model in typing.get_args(union)}


def website_kinds() -> set[str]:
    senders = re.search(r"export const NOTICE_SENDERS = \{(.*?)\n\}", PIPELINE_TS, re.S).group(1)
    return set(re.findall(r"^  (\w+): ", senders, re.M))


def test_every_notice_has_a_sender_and_every_sender_a_notice():
    assert fastapi_kinds() == website_kinds()
    assert len(fastapi_kinds()) >= 16


def test_each_sender_reads_the_fields_its_notice_carries():
    union = typing.get_args(notices.Notice)[0]
    for model in typing.get_args(union):
        kind = model.model_fields["kind"].default
        line = re.search(rf"^  {kind}: \(n\) =>(.*?)(?=^  \w+: \(n\)|^  // eslint|\Z)", PIPELINE_TS, re.S | re.M).group(1)
        used = set(re.findall(r"\bn\.(\w+)", line))
        assert used <= set(model.model_fields) - {"kind"}, (kind, used - set(model.model_fields))
