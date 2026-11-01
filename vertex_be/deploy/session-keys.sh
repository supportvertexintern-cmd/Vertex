#!/usr/bin/env bash
# Writes a stack's session key pair and account-link secret into its env file,
# without printing them (docs/architecture/session-keys-handover.md, K1):
#
#   SESSION_PRIVATE_KEY   base64 of an ES256 (P-256) private key, PKCS#8 PEM;
#                         the backend's alone
#   SESSION_PUBLIC_KEYS   base64 of its public key, PEM; the backend and the
#                         website (comma-separated once rotations begin)
#   ACCOUNT_LINK_SECRET   keys FastAPI's account links; the backend's alone
#
#   bash deploy/session-keys.sh .env.<stack>
#
# Refuses to replace a key that is already set: rotating comes with step K3's
# runbook. Prints only the key id (public). Then redeploy the stack.
set -euo pipefail

ENV_FILE="${1:?usage: $0 .env.<stack>}"
[ -f "$ENV_FILE" ] || { echo "no such env file: $ENV_FILE" >&2; exit 1; }

current() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
for name in SESSION_PRIVATE_KEY SESSION_PUBLIC_KEYS; do
  if [ -n "$(current "$name")" ]; then
    echo "$name is already set in $ENV_FILE; not replacing it (rotation: K3 runbook)" >&2
    exit 1
  fi
done

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null \
  | openssl pkcs8 -topk8 -nocrypt -out "$work/private.pem"
openssl ec -in "$work/private.pem" -pubout -out "$work/public.pem" 2>/dev/null
# The key id, as app/core/session_keys.py and lib/jwt.ts compute it.
kid=$(openssl ec -in "$work/private.pem" -pubout -outform DER 2>/dev/null \
  | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=\n' | cut -c1-16)

# Sets NAME to the contents of a file, in place or appended, never on screen.
put() {
  local name=$1 value
  value=$(cat "$2")
  if grep -q "^$name=" "$ENV_FILE"; then
    VALUE="$value" NAME="$name" awk 'BEGIN { FS = OFS = "=" } $1 == ENVIRON["NAME"] { print ENVIRON["NAME"], ENVIRON["VALUE"]; next } { print }' \
      "$ENV_FILE" > "$work/env" && cat "$work/env" > "$ENV_FILE"
  else
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
}

base64 < "$work/private.pem" | tr -d '\n' > "$work/private.b64"
base64 < "$work/public.pem" | tr -d '\n' > "$work/public.b64"
put SESSION_PRIVATE_KEY "$work/private.b64"
put SESSION_PUBLIC_KEYS "$work/public.b64"

written="SESSION_PRIVATE_KEY, SESSION_PUBLIC_KEYS"
if [ -z "$(current ACCOUNT_LINK_SECRET)" ]; then
  openssl rand -base64 48 | tr -d '\n' > "$work/link"
  put ACCOUNT_LINK_SECRET "$work/link"
  written="$written, ACCOUNT_LINK_SECRET"
fi

echo "Wrote $written to $ENV_FILE (session key id $kid). Redeploy the stack to use them."
