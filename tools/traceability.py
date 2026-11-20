"""Coverage of the security controls and user stories (upstream staging's
tests/tools/traceability.ts; the Complete QA, Security & Implementation
Guide, section 15 "Traceability"): every SI control and every user story
must have at least one passing test.

    python tools/traceability.py [--junit results.xml ...] [--out coverage.md] [--gate]

A control is covered by one of the test IDs the guide lists as proving it
(SEC-AUTHZ-001 ...). Our three suites carry them:
  - the backend's pytest tests as @pytest.mark.proves("SEC-AUTH-014", ...),
    which vertex_be/tests/conftest.py writes into the JUnit report;
  - the website's Vitest tests and the Playwright journeys in the test title,
    as upstream's do ("SEC-AUTHZ-002 every handler checks its caller").
A story is covered by a FUNC-USnn test, or for the security stories
(US-15..23) by the test that proves it.

Without --junit the report counts tests written; with it, only test cases
that passed. --gate makes anything uncovered fail the run (exit 1); without
it the report is for reading (the gate goes on once every control and
story is covered). Standard library only, so CI needs nothing installed.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
TEST_DIRS = (ROOT / "vertex_be" / "tests", ROOT / "vertex" / "src", ROOT / "vertex" / "e2e")
TEST_FILE = re.compile(r"(^test_.*\.py$|\.test\.tsx?$|\.spec\.ts$)")


def _range(prefix: str, start: int, end: int) -> list[str]:
    return [f"{prefix}-{n:03d}" for n in range(start, end + 1)]


# Guide section 15, "Proven by" (11 Nov 2026), as upstream lists it.
PROVEN_BY: dict[str, list[str]] = {
    "SI-01": ["AUTHZ-001", *_range("AUTHZ", 6, 11), "DB-004", "NEXT-001"],
    "SI-02": [*_range("AUTHZ", 2, 5), "NEXT-005", "NEXT-012"],
    "SI-03": ["AUTH-008", "AUTH-009", "AUTHZ-012"],
    "SI-04": ["DB-005", "NEXT-002", "INJ-008", "INJ-009", "BIZ-015"],
    "SI-05": ["NEXT-003", "NEXT-004", "DB-007", "DB-012"],
    "SI-06": ["NEXT-007", "NEXT-008"],
    "SI-07": [*_range("AUTH", 1, 7), "AUTH-010", "AUTH-011"],
    "SI-08": ["AUTH-012", "WEB-003"],
    "SI-09": ["WEB-001", "WEB-002", "WEB-004", "WEB-005", "WEB-009", "WEB-010"],
    "SI-10": [*_range("WEB", 6, 8), "INF-007"],
    "SI-11": ["NEXT-011"],
    "SI-12": ["NEXT-009", "NEXT-010", "INF-006"],
    "SI-13": ["BIZ-005", "BIZ-008", "BIZ-011"],
    "SI-14": ["BIZ-003", "BIZ-007", "DB-010"],
    "SI-15": ["BIZ-002", "BIZ-004", "BIZ-012"],
    "SI-16": ["DB-008", "DB-009", "BIZ-010"],
    "SI-17": ["INF-010", "AUDIT-012"],
    "SI-18": _range("FILE", 1, 12),
    "SI-19": ["INF-009", "AUTH-015"],
    "SI-20": ["INF-001", "INF-002"],
    "SI-21": ["DB-011", "INF-012"],
    "SI-22": ["DB-012", "INF-003", "AUTH-013"],
    "SI-23": _range("AUDIT", 1, 14),
}

# Guide section 10: US-01..US-30 without the removed US-14 and US-24.
STORIES = [f"US-{n:02d}" for n in range(1, 31) if n not in (14, 24)]
STORY_BY_TEST = {
    "US-15": ["AUTHZ-001"], "US-16": ["AUTHZ-007"], "US-17": ["AUTHZ-004"], "US-18": ["AUTHZ-004"], "US-19": ["AUTHZ-004"],
    "US-20": ["AUTHZ-003"], "US-21": ["BIZ-002"], "US-22": ["BIZ-004"], "US-23": ["BIZ-007"],
}

# Stories the business formally left out of this release: not implemented,
# not tested, and the report says so. Each stands only while its decision is
# on record in the evidence file, closed by the approver; a passing test for
# it ends the exclusion. Controls can never be excluded.
EVIDENCE_FILE = ROOT / "vertex" / "docs" / "PHASE6-DEFECT-REPORT.md"
EXCLUDED = {
    "US-25": {"title": "Partner communication log", "defect": "DEF-017",
              "decision": "Communication is handled off-platform; not required for this version", "approved_by": "Mercy", "approved_on": "2026-11-10"},
    "US-28": {"title": "Commission and admin-fee exports", "defect": "DEF-016",
              "decision": "Export is not required for this version", "approved_by": "Mercy", "approved_on": "2026-11-10"},
}

ID = re.compile(r"\b(?:SEC-)?((?:AUTHZ|AUTH|BIZ|DB|NEXT|INJ|WEB|FILE|INF|AUDIT)-\d{3})\b")
STORY = re.compile(r"\bUS(\d{2})(?:\.\.(\d{2}))?")


def ids_in(text: str) -> set[str]:
    return {m.group(1) for m in ID.finditer(text)}


def stories_in(text: str) -> set[str]:
    """ "FUNC-US04..07", "FUNC-US09..11, US27", "FUNC-US13 / FUNC-US29". """
    out: set[str] = set()
    for chunk in re.findall(r"FUNC-[^\"'`\n]*", text):
        for m in STORY.finditer(chunk):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else start
            out.update(f"US-{n:02d}" for n in range(start, end + 1))
    return out


def written() -> tuple[set[str], set[str]]:
    ids: set[str] = set()
    stories: set[str] = set()
    for base in TEST_DIRS:
        for path in base.rglob("*"):
            if path.is_file() and TEST_FILE.search(path.name) and "node_modules" not in path.parts:
                text = path.read_text(encoding="utf-8", errors="ignore")
                ids |= ids_in(text)
                stories |= stories_in(text)
    return ids, stories


def passing(junit_files: list[str]) -> tuple[set[str], set[str]]:
    """IDs and stories of the test cases that passed: from the name, the
    suite (classname) and, for pytest, the "proves" property."""
    ids: set[str] = set()
    stories: set[str] = set()
    for f in junit_files:
        for case in ElementTree.parse(f).iter("testcase"):
            if any(case.find(tag) is not None for tag in ("failure", "error", "skipped")):
                continue
            text = " ".join([case.get("name", ""), case.get("classname", "")]
                            + [p.get("value", "") for p in case.iter("property") if p.get("name") == "proves"])
            ids |= ids_in(text)
            stories |= stories_in(text)
    return ids, stories


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--junit", action="append", default=[], help="a JUnit XML report (repeatable)")
    parser.add_argument("--out", help="write the Markdown report here too")
    parser.add_argument("--gate", action="store_true", help="exit 1 if a control or story isn't covered")
    args = parser.parse_args()

    ids_written, stories_written = written()
    results = passing(args.junit) if args.junit else None

    rows = []
    for si, ids in PROVEN_BY.items():
        found = [i for i in ids if i in ids_written]
        ok = [i for i in ids if i in results[0]] if results else found
        rows.append((si, found, ok, bool(ok)))
    story_rows = []
    for us in STORIES:
        via = STORY_BY_TEST.get(us, [])
        was_written = us in stories_written or any(i in ids_written for i in via)
        covered = (us in results[1] or any(i in results[0] for i in via)) if results else was_written
        story_rows.append((us, was_written, covered))

    evidence = EVIDENCE_FILE.read_text(encoding="utf-8") if EVIDENCE_FILE.exists() else ""
    problems: list[str] = []
    exclusion_rows = []
    for us, x in EXCLUDED.items():
        row = next((line for line in evidence.splitlines() if line.startswith(f"| {x['defect']} |")), "")
        recorded = bool(re.search("closed by", row, re.I)) and x["approved_by"] in row
        if us not in STORIES:
            problems.append(f"{us} is excluded but is not a story in this release")
        if not recorded:
            problems.append(f"{us}: no closed decision by {x['approved_by']} for {x['defect']} in {EVIDENCE_FILE.relative_to(ROOT)}")
        if results and next(r for r in story_rows if r[0] == us)[2]:
            problems.append(f"{us} now has a passing test: remove it from EXCLUDED")
        exclusion_rows.append((us, x, recorded))

    mode = "passing" if results else "written"
    covered = sum(r[3] for r in rows)
    lines = [
        "# Security controls and stories: coverage",
        "",
        f"{covered} of {len(rows)} controls covered by a {mode} test.",
        "",
        "| Control | Test IDs written | Passing | Covered |",
        "| --- | --- | --- | --- |",
        *[f"| {si} | {', '.join(found) or '-'} | {', '.join(ok) or '-' if results else '(no results given)'} | {'yes' if cov else '**no**'} |"
          for si, found, ok, cov in rows],
        "",
        "| Story | Test written | Passing |",
        "| --- | --- | --- |",
        *[f"| {us} | not built | excluded from this release ({EXCLUDED[us]['defect']}) |" if us in EXCLUDED
          else f"| {us} | {'yes' if w else '**no**'} | {('yes' if c else '**no**') if results else '(no results given)'} |"
          for us, w, c in story_rows],
        "",
        "Approved exclusions: not implemented and not tested in this release.",
        "",
        "| Story | What | Defect | Decision | Approved by | Date | Decision on record |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        *[f"| {us} | {x['title']} | {x['defect']} | {x['decision']} | {x['approved_by']} | {x['approved_on']} | "
          f"{'yes' if rec else '**no**'} |" for us, x, rec in exclusion_rows],
    ]
    report = "\n".join(lines)
    print(report)
    if args.out:
        Path(args.out).write_text(report + "\n", encoding="utf-8")

    missing = [si for si, _f, _o, cov in rows if not cov] + [us for us, _w, c in story_rows if not c and us not in EXCLUDED]
    if missing:
        print(f"\nControls and stories without a {mode} test: {', '.join(missing)}", file=sys.stderr)
    if problems:
        print("\nExclusions that do not stand:\n- " + "\n- ".join(problems), file=sys.stderr)
    return 1 if args.gate and (missing or problems) else 0


if __name__ == "__main__":
    sys.exit(main())
