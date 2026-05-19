"""Google Sheets creation and update."""

from __future__ import annotations

import time
from datetime import date
from typing import Optional

from googleapiclient.errors import HttpError

from .drive import build_drive_client, build_sheets_client

HEADERS = [
    "rank",
    "channel_name",
    "channel_url",
    "subscribers",
    "total_views",
    "views_per_sub",
    "uploads_per_month",
    "last_upload_date",
    "primary_language",
    "contact_email",
    "score",
    "pitch_doc_link",
    "notes",
]


def create_sheet(outreach_folder_id: str, date_str: str) -> str:
    """Create a new Google Sheet in the outreach folder. Returns spreadsheet ID."""
    drive = build_drive_client()
    meta = {
        "name": f"Channels - {date_str}",
        "mimeType": "application/vnd.google-apps.spreadsheet",
        "parents": [outreach_folder_id],
    }
    file = drive.files().create(body=meta, fields="id").execute()
    return file["id"]


def write_channels(spreadsheet_id: str, channels: list[dict]) -> None:
    """Write header + all channel rows to the Sheet."""
    sheets = build_sheets_client()

    rows = [HEADERS]
    for i, ch in enumerate(channels, 1):
        rows.append([
            i,
            ch.get("channel_name", ""),
            ch.get("channel_url", ""),
            ch.get("subscribers", 0),
            ch.get("total_views", 0),
            ch.get("views_per_sub", 0),
            ch.get("uploads_per_month", 0),
            ch.get("last_upload_date", ""),
            ch.get("primary_language", ""),
            ch.get("contact_email", ""),
            ch.get("score", 0),
            ch.get("pitch_doc_link", ""),
            "",  # notes — blank for human use
        ])

    _retry(lambda: sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range="Sheet1!A1",
        valueInputOption="RAW",
        body={"values": rows},
    ).execute())

    _format_header(sheets, spreadsheet_id)


def update_column(
    spreadsheet_id: str,
    col_name: str,
    row_values: list[tuple[int, str]],
) -> None:
    """Update a single column for specific rows. row_values = [(1-based-row, value)]."""
    sheets = build_sheets_client()
    col_idx = HEADERS.index(col_name)
    col_letter = chr(ord("A") + col_idx)

    data = []
    for row_num, value in row_values:
        data.append({
            "range": f"Sheet1!{col_letter}{row_num + 1}",  # +1 for header
            "values": [[value]],
        })

    if data:
        _retry(lambda: sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"valueInputOption": "RAW", "data": data},
        ).execute())


def _format_header(sheets, spreadsheet_id: str) -> None:
    """Bold the header row and freeze it."""
    _retry(lambda: sheets.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                {
                    "repeatCell": {
                        "range": {"sheetId": 0, "startRowIndex": 0, "endRowIndex": 1},
                        "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                        "fields": "userEnteredFormat.textFormat.bold",
                    }
                },
                {
                    "updateSheetProperties": {
                        "properties": {"sheetId": 0, "gridProperties": {"frozenRowCount": 1}},
                        "fields": "gridProperties.frozenRowCount",
                    }
                },
            ]
        },
    ).execute())


def _retry(fn, attempts: int = 3) -> None:
    for i in range(attempts):
        try:
            return fn()
        except HttpError as e:
            if i == attempts - 1:
                raise
            time.sleep(2 ** i)
