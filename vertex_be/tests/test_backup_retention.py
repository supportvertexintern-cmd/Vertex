"""Phase 11: backup retention (deploy/backup/prune.py)."""

import importlib.util
from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import BASE_DIR

_spec = importlib.util.spec_from_file_location("prune", BASE_DIR / "deploy" / "backup" / "prune.py")
prune = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(prune)

NOW = datetime(2026, 10, 11, 12, 0, tzinfo=UTC)


def every_6_hours(days: int) -> list[datetime]:
    return [NOW - timedelta(hours=6 * i) for i in range(days * 4)]


def make(root, stamps, complete=True):
    for s in stamps:
        d = root / s.strftime(prune.STAMP)
        d.mkdir()
        if complete:
            (d / "manifest.json").write_text("{}")


def test_main_keeps_everything_from_the_last_48_hours():
    stamps = every_6_hours(2)
    assert prune.keep_main(stamps, NOW) == set(stamps)


def test_main_thins_older_backups_to_daily_weekly_monthly():
    stamps = every_6_hours(400)
    kept = prune.keep_main(stamps, NOW)
    older = [s for s in kept if NOW - s > timedelta(hours=48)]
    days_14 = [s for s in older if NOW - s <= timedelta(days=14)]
    assert len({s.date() for s in days_14}) == len(days_14)  # one per day
    assert max(NOW - s for s in kept) <= timedelta(days=366)  # nothing past a year
    assert len(kept) < 50  # 9 recent + ~12 daily + ~8 weekly + ~12 monthly, with overlaps
    # Every month of the last year still has a restore point.
    assert {(s.year, s.month) for s in kept} >= {
        ((NOW - timedelta(days=30 * m)).year, (NOW - timedelta(days=30 * m)).month) for m in range(12)
    }


def test_staging_keeps_the_newest_four():
    stamps = [NOW - timedelta(weeks=i) for i in range(10)]
    assert prune.keep_staging(stamps, NOW) == set(stamps[:4])


def test_plan_deletes_old_interrupted_backups_but_not_a_running_one(tmp_path):
    make(tmp_path, [NOW - timedelta(hours=1)])
    make(tmp_path, [NOW - timedelta(hours=2)], complete=False)  # may still be running
    make(tmp_path, [NOW - timedelta(days=3)], complete=False)  # interrupted
    (tmp_path / "drills").mkdir()  # not a backup: untouched
    names = [d.name for d in prune.plan(tmp_path, "main", NOW)]
    assert names == [(NOW - timedelta(days=3)).strftime(prune.STAMP)]


@pytest.mark.parametrize("policy", ["main", "staging"])
def test_the_newest_complete_backup_is_never_deleted(tmp_path, policy):
    # Backups stopped over a year ago: the last one is all there is.
    make(tmp_path, [NOW - timedelta(days=500), NOW - timedelta(days=400)])
    deleted = {d.name for d in prune.plan(tmp_path, policy, NOW)}
    assert (NOW - timedelta(days=400)).strftime(prune.STAMP) not in deleted


def test_offsite_keeps_7_daily_4_weekly_6_monthly():
    # E5: two years of 6-hourly backups thin to at most 7 + 4 + 6 restore points.
    stamps = every_6_hours(730)
    kept = prune.keep_offsite(stamps, NOW)
    assert max(stamps) in kept
    assert len(kept) <= 17
    newest_days = sorted({s.date() for s in kept}, reverse=True)[:7]
    assert newest_days == [(NOW - timedelta(days=i)).date() for i in range(7)]  # 7 consecutive days
    months = {(s.year, s.month) for s in kept}
    assert len(months) == 6
    assert min(NOW - s for s in kept if (s.year, s.month) == min(months)) < timedelta(days=6 * 31)


def test_offsite_keeps_the_newest_of_each_day():
    stamps = every_6_hours(1)  # 12:00, 06:00, 00:00 today and 18:00 yesterday
    assert prune.keep_offsite(stamps, NOW) == {NOW, NOW - timedelta(hours=18)}
