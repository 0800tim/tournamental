"""Upload outreach CSV lists in this directory to Google Sheets in Tim's Drive.

Reuses the OAuth credentials and Drive/Sheets clients already wired up for the
YouTube discovery tool (`tools/youtube-discovery/src/drive.py`), so this script
needs no separate auth setup — first run prompts a consent flow only if the
cached token at `~/.config/tournamental-youtube/token.json` is missing or stale.

Behaviour:

  * One Sheet per CSV. Sheet name = CSV basename (no extension).
  * All Sheets live in Drive folder `Tournamental GTM / Outreach Lists` (created
    on first run; sibling of the existing `YouTube Outreach` folder).
  * An `_sheets-index.json` file in this directory maps `csv_filename ->
    spreadsheet_id` so a second run UPDATES the existing Sheet (clears, then
    re-writes) rather than creating a duplicate.
  * The header row is bolded + frozen; data rows are written verbatim from CSV.
  * A `Master Index` Sheet is created/updated with a row per list, including a
    clickable Sheet URL — gives Tim one URL to bookmark.

Usage:

    # Upload (or refresh) every *.csv in this directory:
    cd tools/youtube-discovery && uv run python ../outreach-lists/upload_to_sheets.py

    # Upload a single file:
    cd tools/youtube-discovery && uv run python ../outreach-lists/upload_to_sheets.py \
        ../outreach-lists/nz-football-clubs.csv

Run from inside `tools/youtube-discovery` (where pyproject + uv env live) so the
`src` package import resolves.
"""

from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

# `tools/youtube-discovery/src/...` package — added to sys.path so this file can
# be run either via `uv run` from inside that directory or with the path
# inserted by the caller.
_THIS = Path(__file__).resolve()
_REPO_ROOT = _THIS.parents[2]
_YT_TOOL = _REPO_ROOT / "tools" / "youtube-discovery"
if str(_YT_TOOL) not in sys.path:
    sys.path.insert(0, str(_YT_TOOL))

from src.drive import (  # type: ignore[import]
    build_drive_client,
    build_sheets_client,
    find_or_create_folder,
)
from googleapiclient.errors import HttpError  # type: ignore[import]

OUTREACH_DIR = _THIS.parent
INDEX_PATH = OUTREACH_DIR / "_sheets-index.json"
DRIVE_FOLDER_PATH = ("Tournamental GTM", "Outreach Lists")
MASTER_INDEX_NAME = "_Master Index"


def _load_index() -> dict[str, str]:
    if INDEX_PATH.exists():
        return json.loads(INDEX_PATH.read_text())
    return {}


def _save_index(idx: dict[str, str]) -> None:
    INDEX_PATH.write_text(json.dumps(idx, indent=2, sort_keys=True) + "\n")


def _retry(fn, attempts: int = 4):
    """Retry on transient HTTP errors with exponential backoff."""
    for i in range(attempts):
        try:
            return fn()
        except HttpError as e:
            if i == attempts - 1:
                raise
            time.sleep(2**i)


def _ensure_folder() -> str:
    drive = build_drive_client()
    parent = None
    folder_id = None
    for name in DRIVE_FOLDER_PATH:
        folder_id = find_or_create_folder(drive, name, parent)
        parent = folder_id
    assert folder_id is not None
    return folder_id


def _read_csv(path: Path) -> list[list[str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        return [list(row) for row in reader]


def _create_or_get_sheet(name: str, folder_id: str, existing_id: str | None) -> str:
    """Return spreadsheet ID. If existing_id is present, verify it still exists."""
    drive = build_drive_client()
    if existing_id:
        try:
            drive.files().get(fileId=existing_id, fields="id,trashed").execute()
            return existing_id
        except HttpError:
            pass  # fall through to create

    meta = {
        "name": name,
        "mimeType": "application/vnd.google-apps.spreadsheet",
        "parents": [folder_id],
    }
    file = _retry(lambda: drive.files().create(body=meta, fields="id").execute())
    return file["id"]


def _clear_sheet(sheets, spreadsheet_id: str) -> None:
    _retry(
        lambda: sheets.spreadsheets()
        .values()
        .clear(spreadsheetId=spreadsheet_id, range="Sheet1")
        .execute()
    )


def _write_rows(sheets, spreadsheet_id: str, rows: list[list[str]]) -> None:
    _retry(
        lambda: sheets.spreadsheets()
        .values()
        .update(
            spreadsheetId=spreadsheet_id,
            range="Sheet1!A1",
            valueInputOption="RAW",
            body={"values": rows},
        )
        .execute()
    )


def _format_header_and_widths(sheets, spreadsheet_id: str, col_count: int) -> None:
    requests: list[dict] = [
        {
            "repeatCell": {
                "range": {"sheetId": 0, "startRowIndex": 0, "endRowIndex": 1},
                "cell": {
                    "userEnteredFormat": {
                        "textFormat": {"bold": True},
                        "backgroundColor": {"red": 0.92, "green": 0.92, "blue": 0.92},
                    }
                },
                "fields": "userEnteredFormat(textFormat.bold,backgroundColor)",
            }
        },
        {
            "updateSheetProperties": {
                "properties": {"sheetId": 0, "gridProperties": {"frozenRowCount": 1}},
                "fields": "gridProperties.frozenRowCount",
            }
        },
        {
            "autoResizeDimensions": {
                "dimensions": {
                    "sheetId": 0,
                    "dimension": "COLUMNS",
                    "startIndex": 0,
                    "endIndex": col_count,
                }
            }
        },
    ]
    _retry(
        lambda: sheets.spreadsheets()
        .batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests})
        .execute()
    )


def _upload_one(csv_path: Path, folder_id: str, index: dict[str, str]) -> str:
    """Upload one CSV. Returns the Sheet's URL."""
    rows = _read_csv(csv_path)
    if not rows:
        print(f"  [skip] {csv_path.name}: empty")
        return ""

    sheet_name = csv_path.stem
    existing = index.get(csv_path.name)
    sheet_id = _create_or_get_sheet(sheet_name, folder_id, existing)
    index[csv_path.name] = sheet_id

    sheets = build_sheets_client()
    _clear_sheet(sheets, sheet_id)
    _write_rows(sheets, sheet_id, rows)
    _format_header_and_widths(sheets, sheet_id, col_count=len(rows[0]))

    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}"
    print(f"  [ok]   {csv_path.name} ({len(rows) - 1} rows) -> {url}")
    return url


def _refresh_master_index(folder_id: str, index: dict[str, str]) -> str:
    """Build a Master Index Sheet with name + row count + clickable URL per list."""
    drive = build_drive_client()
    sheets = build_sheets_client()

    master_id = index.get(MASTER_INDEX_NAME)
    master_id = _create_or_get_sheet(MASTER_INDEX_NAME, folder_id, master_id)
    index[MASTER_INDEX_NAME] = master_id

    rows: list[list[str]] = [["list", "rows", "sheet_url", "csv_path"]]
    for csv_name in sorted(index):
        if csv_name == MASTER_INDEX_NAME:
            continue
        csv_path = OUTREACH_DIR / csv_name
        if not csv_path.exists():
            continue
        data_rows = max(0, len(_read_csv(csv_path)) - 1)
        url = f"https://docs.google.com/spreadsheets/d/{index[csv_name]}"
        rows.append([
            csv_path.stem,
            str(data_rows),
            f'=HYPERLINK("{url}","open")',
            str(csv_path.relative_to(_REPO_ROOT)),
        ])

    _clear_sheet(sheets, master_id)
    _retry(
        lambda: sheets.spreadsheets()
        .values()
        .update(
            spreadsheetId=master_id,
            range="Sheet1!A1",
            valueInputOption="USER_ENTERED",  # USER_ENTERED so HYPERLINK() parses
            body={"values": rows},
        )
        .execute()
    )
    _format_header_and_widths(sheets, master_id, col_count=len(rows[0]))

    return f"https://docs.google.com/spreadsheets/d/{master_id}"


def main(argv: list[str]) -> int:
    if len(argv) > 1:
        targets = [Path(p).resolve() for p in argv[1:]]
        for t in targets:
            if not t.exists():
                print(f"missing: {t}", file=sys.stderr)
                return 2
    else:
        targets = sorted(OUTREACH_DIR.glob("*.csv"))

    if not targets:
        print("no CSV files found in", OUTREACH_DIR)
        return 0

    folder_id = _ensure_folder()
    index = _load_index()

    print(f"folder: Drive / {' / '.join(DRIVE_FOLDER_PATH)} (id={folder_id})")
    print(f"uploading {len(targets)} CSV file(s)...")
    for t in targets:
        _upload_one(t, folder_id, index)
        _save_index(index)  # save incrementally so a partial run still records progress

    master_url = _refresh_master_index(folder_id, index)
    _save_index(index)

    print()
    print(f"master index: {master_url}")
    print(f"local index : {INDEX_PATH.relative_to(_REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
