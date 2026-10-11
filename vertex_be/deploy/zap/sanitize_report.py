"""Removes credentials from ZAP reports before they're kept or shared.

    python sanitize_report.py <report file>...   (rewrites in place)

ZAP reports quote request headers and URLs, so the scan account's session
cookie and any signed link tokens would otherwise be stored in the report.
"""

import re
import sys
from pathlib import Path

PATTERNS = [
    (re.compile(r"(auth_token=)[A-Za-z0-9._-]+"), r"\1[REDACTED]"),
    (re.compile(r"((?:[?&]|\\u0026)token=)[A-Za-z0-9._%-]+"), r"\1[REDACTED]"),
    (re.compile(r"(X-Upload-Token:\s*)[^\s\"\\]+", re.I), r"\1[REDACTED]"),
    (re.compile(r"(Authorization:\s*Bearer\s+)[^\s\"\\]+", re.I), r"\1[REDACTED]"),
    # Any remaining JWT-shaped string.
    (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"), "[REDACTED-JWT]"),
]


def main() -> None:
    for name in sys.argv[1:]:
        path = Path(name)
        text = path.read_text(encoding="utf-8", errors="replace")
        for pattern, replacement in PATTERNS:
            text = pattern.sub(replacement, text)
        path.write_text(text, encoding="utf-8")
        left = len(re.findall(r"eyJ[A-Za-z0-9_-]{10,}\.", text))
        print(f"{path.name}: sanitized ({left} token-like strings left)")


if __name__ == "__main__":
    main()
