"""Backup retention (Phase 11).

    python prune.py <backups dir for one project> <policy> [--apply]

Backups are directories named by their UTC start time (20261011T120000Z).
Without --apply it only prints what it would delete.

Policies:
  main     every backup from the last 48 hours; then the newest of each day
           for 14 days, of each ISO week for 8 weeks, of each month for 12
           months. Everything older is deleted.
  staging  the newest 4.
  offsite  the off-site copy (E5, offsite.py): the newest of each day for 7
           days, of each ISO week for 4 weeks, of each month for 6 months.

A directory without a manifest.json (an interrupted backup) is deleted once
it's more than a day old, and never counted as a kept backup. The newest
complete backup is never deleted, whatever its age.
"""

from __future__ import annotations

import shutil
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

STAMP = "%Y%m%dT%H%M%SZ"


def parse(name: str) -> datetime | None:
    try:
        return datetime.strptime(name, STAMP).replace(tzinfo=UTC)
    except ValueError:
        return None


def keep_main(stamps: list[datetime], now: datetime) -> set[datetime]:
    keep = {s for s in stamps if now - s <= timedelta(hours=48)}
    newest = sorted(stamps, reverse=True)
    for window, bucket in (
        (timedelta(days=14), lambda s: s.date()),
        (timedelta(weeks=8), lambda s: s.isocalendar()[:2]),
        (timedelta(days=366), lambda s: (s.year, s.month)),
    ):
        seen = set()
        for s in newest:
            if now - s <= window and bucket(s) not in seen:
                seen.add(bucket(s))
                keep.add(s)
    return keep


def keep_staging(stamps: list[datetime], now: datetime) -> set[datetime]:
    return set(sorted(stamps, reverse=True)[:4])


def keep_offsite(stamps: list[datetime], now: datetime) -> set[datetime]:
    keep: set[datetime] = set()
    newest = sorted(stamps, reverse=True)
    for count, bucket in ((7, lambda s: s.date()), (4, lambda s: s.isocalendar()[:2]), (6, lambda s: (s.year, s.month))):
        seen: list[object] = []
        for s in newest:
            if bucket(s) not in seen:
                if len(seen) == count:
                    break
                seen.append(bucket(s))
                keep.add(s)
    if stamps:
        keep.add(max(stamps))
    return keep


POLICIES = {"main": keep_main, "staging": keep_staging, "offsite": keep_offsite}


def plan(root: Path, policy: str, now: datetime) -> list[Path]:
    """The directories the policy would delete."""
    complete: dict[datetime, Path] = {}
    delete: list[Path] = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        stamp = parse(d.name)
        if stamp is None:
            continue  # not ours (drill reports, hand-made folders)
        if not (d / "manifest.json").exists():
            if now - stamp > timedelta(days=1):
                delete.append(d)
            continue
        complete[stamp] = d
    kept = POLICIES[policy](list(complete), now)
    # However old, the newest complete backup always stays: if backups have
    # stopped, the last one is the only restore point left.
    if complete:
        kept.add(max(complete))
    delete += [d for s, d in complete.items() if s not in kept]
    return sorted(delete)


def main() -> int:
    root, policy = Path(sys.argv[1]), sys.argv[2]
    apply = "--apply" in sys.argv[3:]
    if not root.is_dir():
        return 0
    for d in plan(root, policy, datetime.now(UTC)):
        print(("deleting " if apply else "would delete ") + d.name)
        if apply:
            shutil.rmtree(d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
