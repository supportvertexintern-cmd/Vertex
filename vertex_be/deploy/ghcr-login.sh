#!/usr/bin/env sh
# Logs Docker in to ghcr.io with retries. Expects GHCR_USER and GHCR_TOKEN.
#
# Run through Git Bash on the Windows runner, not PowerShell: Windows
# PowerShell prepends a UTF-8 BOM to text piped into a native program, which
# corrupts the token and makes the registry answer "denied". printf passes
# the token through byte for byte.
set -u

attempts="${LOGIN_ATTEMPTS:-5}"
attempt=1
while ! printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin; do
  if [ "$attempt" -ge "$attempts" ]; then
    echo "GHCR login failed after $attempts attempts" >&2
    exit 1
  fi
  wait=$((attempt * 15))
  echo "GHCR login attempt $attempt failed; retrying in ${wait}s" >&2
  sleep "$wait"
  attempt=$((attempt + 1))
done
