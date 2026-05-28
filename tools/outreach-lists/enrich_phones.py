"""Extract phone numbers from the `notes` (or equivalent) column of each
outreach CSV and append a clean `phone` column for HighLevel voice-AI consumption.

Run idempotently: re-running on already-enriched CSVs detects the existing
`phone` column and re-extracts (so manual edits to notes propagate).

Heuristics:
  * Matches +CC then 5-15 digits with optional spaces/dashes/parens.
  * Also matches "(0xx) yyyyy" forms and bare "0xxx-xxxxxxx" for NZ/UK locals.
  * Skips obvious non-phone numeric strings (years 19xx-20xx, lone counts).
  * Picks the FIRST plausible match per row. Multiple numbers are rare and the
    operator can dig into notes when needed.
  * Outputs in E.164-ish form when a `+` is present (kept verbatim), otherwise
    leaves the local form alone so HL can normalise.

Usage:
    uv run python tools/outreach-lists/enrich_phones.py          # all CSVs
    uv run python tools/outreach-lists/enrich_phones.py uk-football-clubs.csv
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

OUTREACH_DIR = Path(__file__).resolve().parent

# Order matters: try +CC first (most specific), then NZ/UK locals.
PHONE_PATTERNS = [
    # +CC followed by 5-15 digits with optional separators
    re.compile(r"(\+\d{1,3}[\s\-]?\(?\d{1,5}\)?[\s\-]?\d{1,5}[\s\-]?\d{1,6}(?:[\s\-]?\d{1,6})?)"),
    # (0xx) yyyyyy
    re.compile(r"(\(0\d{1,4}\)[\s\-]?\d{4,10})"),
    # 0xx-yyy-yyyy or 0xxxxxxxxx
    re.compile(r"(?<![\d])(0\d{2,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})(?![\d])"),
]

YEAR_RE = re.compile(r"^(19|20)\d{2}$")  # filter year noise


def _normalise(raw: str) -> str:
    """Clean whitespace and drop trailing punctuation; keep +/digits/space/dash/parens."""
    s = raw.strip()
    # strip trailing punctuation that the regex sometimes catches
    while s and s[-1] in ".,;:":
        s = s[:-1]
    # collapse internal whitespace
    s = re.sub(r"\s+", " ", s)
    return s


def extract_phone(text: str) -> str:
    if not text:
        return ""
    for pat in PHONE_PATTERNS:
        for m in pat.finditer(text):
            candidate = _normalise(m.group(1))
            digits_only = re.sub(r"\D", "", candidate)
            if len(digits_only) < 6 or len(digits_only) > 16:
                continue
            if YEAR_RE.match(digits_only):
                continue
            return candidate
    return ""


def _find_notes_column(header: list[str]) -> str | None:
    """Find the column likely to contain phone hints."""
    for candidate in ("notes", "note", "Notes", "description"):
        if candidate in header:
            return candidate
    return None


def enrich(csv_path: Path) -> tuple[int, int]:
    """Add/refresh a `phone` column. Returns (rows_total, rows_with_phone)."""
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        rows = list(csv.reader(f))
    if not rows:
        return 0, 0

    header = rows[0]
    notes_col = _find_notes_column(header)
    if notes_col is None:
        print(f"  [skip] {csv_path.name}: no notes column")
        return len(rows) - 1, 0

    notes_idx = header.index(notes_col)

    if "phone" in header:
        phone_idx = header.index("phone")
    else:
        phone_idx = len(header)
        header.append("phone")
        for r in rows[1:]:
            r.append("")

    extracted = 0
    for r in rows[1:]:
        # pad short rows defensively (shouldn't happen but does once in a while)
        while len(r) <= max(phone_idx, notes_idx):
            r.append("")
        # also check the email and role columns for phones occasionally embedded there
        haystack = " | ".join(str(r[i]) for i in range(len(r)) if i != phone_idx)
        phone = extract_phone(haystack)
        r[phone_idx] = phone
        if phone:
            extracted += 1

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows[1:])

    return len(rows) - 1, extracted


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        targets = [OUTREACH_DIR / Path(p).name for p in argv[1:]]
    else:
        targets = sorted(OUTREACH_DIR.glob("*.csv"))

    print(f"enriching {len(targets)} file(s) with phone column...")
    grand_total = 0
    grand_with_phone = 0
    for t in targets:
        total, with_phone = enrich(t)
        pct = (100.0 * with_phone / total) if total else 0
        print(f"  [ok] {t.name}: {with_phone}/{total} rows with phone ({pct:.0f}%)")
        grand_total += total
        grand_with_phone += with_phone

    print()
    print(f"total: {grand_with_phone}/{grand_total} rows with extracted phone")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
