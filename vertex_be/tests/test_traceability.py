"""tools/traceability.py, the security traceability report (upstream
staging's gate): how it reads test IDs and stories, that only passing tests
count, and that the excluded stories have their decisions on record."""

from __future__ import annotations

import importlib.util
import textwrap

import pytest

from app.core.config import BASE_DIR

spec = importlib.util.spec_from_file_location("traceability", BASE_DIR.parent / "tools" / "traceability.py")
traceability = importlib.util.module_from_spec(spec)
spec.loader.exec_module(traceability)


def test_ids_are_read_with_or_without_the_sec_prefix():
    assert traceability.ids_in("SEC-AUTHZ-002 SEC-NEXT-005 every handler; DB-010 too; not SEC-FOO-001") == {"AUTHZ-002", "NEXT-005", "DB-010"}


def test_stories_are_read_from_ranges_and_lists():
    assert traceability.stories_in("FUNC-US04..07 the VA works the partner") == {"US-04", "US-05", "US-06", "US-07"}
    assert traceability.stories_in("FUNC-US09..11, US27 HR approval") == {"US-09", "US-10", "US-11", "US-27"}
    assert traceability.stories_in("FUNC-US13 / FUNC-US29 team performance") == {"US-13", "US-29"}
    assert traceability.stories_in("US12 without the FUNC- prefix") == set()


def test_only_passing_cases_count(tmp_path):
    report = tmp_path / "junit.xml"
    report.write_text(textwrap.dedent("""\
        <testsuites><testsuite name="s">
          <testcase classname="tests.test_x" name="test_ok"><properties><property name="proves" value="SEC-AUTH-014"/></properties></testcase>
          <testcase classname="tests.test_x" name="test_bad"><properties><property name="proves" value="SEC-AUTH-015"/></properties><failure message="x"/></testcase>
          <testcase classname="tests.test_x" name="test_skip"><properties><property name="proves" value="SEC-AUTH-013"/></properties><skipped/></testcase>
          <testcase classname="SEC-WEB-006 the CSP" name="is the nonce in the policy"/>
          <testcase classname="journeys" name="FUNC-US01 Michael creates a VA account"/>
        </testsuite></testsuites>"""), encoding="utf-8")
    ids, stories = traceability.passing([str(report)])
    assert ids == {"AUTH-014", "WEB-006"}
    assert stories == {"US-01"}


def test_every_proven_by_id_is_a_known_kind():
    for si, ids in traceability.PROVEN_BY.items():
        assert ids and all(traceability.ids_in(i) == {i} for i in ids), si


@pytest.mark.parametrize("story", sorted(traceability.EXCLUDED))
def test_an_excluded_story_has_its_closed_decision_on_record(story):
    x = traceability.EXCLUDED[story]
    evidence = traceability.EVIDENCE_FILE.read_text(encoding="utf-8")
    row = next(line for line in evidence.splitlines() if line.startswith(f"| {x['defect']} |"))
    assert "closed by" in row.lower() and x["approved_by"] in row
    assert story in traceability.STORIES
