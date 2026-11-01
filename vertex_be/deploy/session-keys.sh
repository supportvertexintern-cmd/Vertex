#!/usr/bin/env bash
# A stack's session key pair and account-link secret, in its env file, never
# printed (docs/architecture/session-keys-handover.md):
#
#   SESSION_PRIVATE_KEY       base64 of an ES256 (P-256) private key, PKCS#8
#                             PEM; the backend's alone
#   SESSION_PUBLIC_KEYS       base64 of public keys, PEM, comma-separated; the
#                             backend and the website
#   ACCOUNT_LINK_SECRET       keys FastAPI's account links; the backend's alone
#   SESSION_PRIVATE_KEY_NEXT  during a rotation only; never given to a service
#
#   bash deploy/session-keys.sh .env.<stack>                    first keys
#   bash deploy/session-keys.sh --stage .env.<stack>            rotation, 1 of 3
#   bash deploy/session-keys.sh --promote .env.<stack>          rotation, 2 of 3
#   bash deploy/session-keys.sh --retire .env.<stack>           rotation, 3 of 3
#   bash deploy/session-keys.sh --new-link-secret .env.<stack>  replace the link secret
#
# Redeploy the stack after each. A rotation signs nobody out: --stage lists
# the new public key before anything signs with it, --promote signs with it,
# and --retire (15 minutes later at the earliest, when the last token signed
# with the old key has expired) drops the old one. A new link secret ends
# every account link already sent: re-send pending invites. Runbook:
# docs/security/session-management.md §5. Prints only key ids (public).
set -euo pipefail

MODE=init
case "${1:-}" in
  --stage|--promote|--retire|--new-link-secret) MODE=${1#--}; shift ;;
esac
ENV_FILE="${1:?usage: $0 [--stage|--promote|--retire|--new-link-secret] .env.<stack>}"
[ -f "$ENV_FILE" ] || { echo "no such env file: $ENV_FILE" >&2; exit 1; }

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

current() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1; }
fail() { echo "$*" >&2; exit 1; }

# Sets NAME to the contents of a file (or removes it, with no file), in
# place or appended, never on screen.
put() {
  local name=$1 value=""
  [ -n "${2:-}" ] && value=$(cat "$2")
  if grep -q "^$name=" "$ENV_FILE"; then
    VALUE="$value" NAME="$name" DROP="${2:+keep}" awk 'BEGIN { FS = OFS = "=" }
      $1 == ENVIRON["NAME"] { if (ENVIRON["DROP"] == "keep") print ENVIRON["NAME"], ENVIRON["VALUE"]; next } { print }' \
      "$ENV_FILE" > "$work/env" && cat "$work/env" > "$ENV_FILE"
  elif [ -n "${2:-}" ]; then
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
}

# A new key pair: private.pem, private.b64, public.b64.
new_pair() {
  openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null \
    | openssl pkcs8 -topk8 -nocrypt -out "$work/private.pem"
  base64 < "$work/private.pem" | tr -d '\n' > "$work/private.b64"
  openssl ec -in "$work/private.pem" -pubout 2>/dev/null | base64 | tr -d '\n' > "$work/public.b64"
}

# The key id of a private key given as base64 (stdin), as
# app/core/session_keys.py and lib/jwt.ts compute it.
kid_of_private() {
  base64 -d | openssl ec -pubout -outform DER 2>/dev/null \
    | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=\n' | cut -c1-16
}
kid_of_public() {
  base64 -d | openssl pkey -pubin -outform DER 2>/dev/null \
    | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=\n' | cut -c1-16
}

new_link_secret() {
  openssl rand -base64 48 | tr -d '\n' > "$work/link"
  put ACCOUNT_LINK_SECRET "$work/link"
}

case "$MODE" in
  init)
    for name in SESSION_PRIVATE_KEY SESSION_PUBLIC_KEYS; do
      [ -z "$(current "$name")" ] || fail "$name is already set in $ENV_FILE; not replacing it (rotate with --stage)"
    done
    new_pair
    put SESSION_PRIVATE_KEY "$work/private.b64"
    put SESSION_PUBLIC_KEYS "$work/public.b64"
    written="SESSION_PRIVATE_KEY, SESSION_PUBLIC_KEYS"
    if [ -z "$(current ACCOUNT_LINK_SECRET)" ]; then
      new_link_secret
      written="$written, ACCOUNT_LINK_SECRET"
    fi
    echo "Wrote $written to $ENV_FILE (session key id $(kid_of_private < "$work/private.b64")). Redeploy the stack."
    ;;
  stage)
    [ -n "$(current SESSION_PRIVATE_KEY)" ] || fail "no SESSION_PRIVATE_KEY in $ENV_FILE: run without a flag first"
    [ -z "$(current SESSION_PRIVATE_KEY_NEXT)" ] || fail "a rotation is already staged in $ENV_FILE: --promote it"
    new_pair
    put SESSION_PRIVATE_KEY_NEXT "$work/private.b64"
    printf '%s,%s' "$(cat "$work/public.b64")" "$(current SESSION_PUBLIC_KEYS)" > "$work/listed"
    put SESSION_PUBLIC_KEYS "$work/listed"
    echo "Staged key id $(kid_of_private < "$work/private.b64"): listed, not yet signing. Redeploy, then --promote."
    ;;
  promote)
    [ -n "$(current SESSION_PRIVATE_KEY_NEXT)" ] || fail "nothing staged in $ENV_FILE: --stage first"
    current SESSION_PRIVATE_KEY_NEXT > "$work/next"
    put SESSION_PRIVATE_KEY "$work/next"
    put SESSION_PRIVATE_KEY_NEXT
    echo "Signing with key id $(kid_of_private < "$work/next") after the redeploy. Redeploy, then --retire 15 minutes later at the earliest."
    ;;
  retire)
    [ -z "$(current SESSION_PRIVATE_KEY_NEXT)" ] || fail "a rotation is staged in $ENV_FILE: --promote it first"
    signing=$(current SESSION_PRIVATE_KEY | kid_of_private)
    kept=""
    IFS=',' read -r -a listed <<< "$(current SESSION_PUBLIC_KEYS)"
    for key in "${listed[@]}"; do
      key=$(printf '%s' "$key" | tr -d ' ')
      [ -n "$key" ] && [ "$(printf '%s' "$key" | kid_of_public)" = "$signing" ] && kept=$key
    done
    [ -n "$kept" ] || fail "the signing key's public key is not listed in $ENV_FILE; not changing anything"
    printf '%s' "$kept" > "$work/kept"
    put SESSION_PUBLIC_KEYS "$work/kept"
    echo "Listed only key id $signing ($(( ${#listed[@]} - 1 )) retired). Redeploy."
    ;;
  new-link-secret)
    new_link_secret
    echo "Replaced ACCOUNT_LINK_SECRET in $ENV_FILE. Redeploy; links already sent stop working: re-send pending invites."
    ;;
esac
