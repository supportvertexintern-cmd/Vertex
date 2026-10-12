#!/usr/bin/env bash
# Monthly off-site restore test (E5): downloads the newest off-site copy of a
# project (admin credentials) and runs the full restore drill on it, so the
# copy that would be used after losing this PC is proven, not just present.
# The download is deleted afterwards (it's ciphertext, but no reason to keep
# a second local copy). Alerts if the fetch or the drill fails.
#
#   bash deploy/backup/offsite-drill.sh [project]     (from vertex_be/; default vertex-main)
set -u
export MSYS_NO_PATHCONV=1
P="${1:-vertex-main}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${BACKUP_ROOT:-D:/VertexData/backups}"
DEST="$ROOT/offsite-restore/$(date -u +%Y%m%dT%H%M%SZ)"
trap 'rm -rf "$DEST"' EXIT
if ! B=$(python "$HERE/offsite.py" fetch "$P" latest "$DEST" | tail -1) || [ ! -f "$B/manifest.json" ]; then
  bash "$HERE/alert.sh" offsite_fetch_failed "The off-site copy of $P could not be downloaded" "see the scheduled task log"
  exit 1
fi
echo "fetched $B"
if ! bash "$HERE/restore-drill.sh" "$P" "$B"; then
  bash "$HERE/alert.sh" offsite_drill_failed "The restore drill of the off-site copy of $P failed" "report in $ROOT/drills/"
  exit 1
fi
