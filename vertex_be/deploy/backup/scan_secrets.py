"""Checks a decrypted backup for things that must not be in it (Phase 11).

    pg_restore -f - ... | python scan_secrets.py <env-file> <report.json>

Reads the database dump as SQL text on stdin and counts:
  - every secret value configured in the stack's env file (keys named like
    *SECRET*, *PASSWORD*, *_KEY*, *TOKEN*, *PASS*; values of 8+ characters)
  - credential shapes: private keys, AWS access keys, Stripe secret keys,
    connection strings with a password, JWTs
  - bcrypt password hashes (expected: users must be able to sign in after a
    restore; reported, not failed)
Only counts and key *names* are written; a matched value is never output.
"""

from __future__ import annotations

import json
import re
import sys

SECRET_KEY_NAME = re.compile(r"SECRET|PASSWORD|_KEY|TOKEN|PASS", re.I)
PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "aws_access_key": re.compile(rb"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
    "stripe_secret_key": re.compile(rb"\b(sk|rk)_(live|test)_[0-9A-Za-z]{10,}"),
    "credentialed_url": re.compile(rb"[a-z][a-z0-9+.-]*://[^\s:/@'\"]+:[^\s@/'\"]+@"),
    "jwt": re.compile(rb"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
}
EXPECTED = {"bcrypt_hash": re.compile(rb"\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}")}


def env_secrets(path: str) -> dict[str, bytes]:
    out = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip().strip("'\"")
        if SECRET_KEY_NAME.search(key) and len(value) >= 8:
            out[key.strip()] = value.encode()
    return out


def main() -> int:
    secrets = env_secrets(sys.argv[1])
    data = sys.stdin.buffer.read()
    found = {
        "env_secrets": {k: data.count(v) for k, v in secrets.items() if data.count(v)},
        "env_secrets_checked": len(secrets),
        "patterns": {name: len(p.findall(data)) for name, p in PATTERNS.items()},
        "expected": {name: len(p.findall(data)) for name, p in EXPECTED.items()},
        "bytes_scanned": len(data),
    }
    found["clean"] = not found["env_secrets"] and not any(found["patterns"].values())
    json.dump(found, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
