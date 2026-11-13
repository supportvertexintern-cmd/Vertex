"""Passport numbers in one shape (2026-11-12).

A passport number is an identity key: the partner duplicate check compares
it, and HR finds a person's other candidates by it. A candidate registered
three times as "AK1791697", "AK1791697 " and "AK1791697  ": each paste
carried a trailing space, the exact match found nothing, and three
candidates, applications and cases were made. Whitespace is never part of a
passport number, so all of it goes, and letters are upper-cased (they are
printed that way). Every request model that takes one uses PassportNumber;
migration 0022 brought the stored values into the same shape.
"""

from __future__ import annotations

import re
from typing import Annotated, Any

from pydantic import BeforeValidator

# \s on a str covers the non-breaking space and other Unicode spaces.
_SPACE = re.compile(r"\s+")


def normalize_passport(value: str) -> str:
    return _SPACE.sub("", value).upper()


def _normalized(value: Any) -> Any:
    # Before the str check, so a length rule (min_length) runs on what's kept:
    # "   " becomes "" and a required field still says it's required.
    return normalize_passport(value) if isinstance(value, str) else value


PassportNumber = Annotated[str, BeforeValidator(_normalized)]
