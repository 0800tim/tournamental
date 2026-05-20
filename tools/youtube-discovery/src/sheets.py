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
    "custom_url",
    "channel_url",
    "country",
    "subscribers",
    "subscriber_tier",
    "total_views",
    "views_per_sub",
    "uploads_per_month",
    "last_upload_date",
    "days_since_last_upload",
    "primary_language",
    "score",
    "contact_email",
    "twitter",
    "instagram",
    "facebook",
    "tiktok",
    "linkedin",
    "website",
    "description_preview",
    "pitch_doc_link",
    "notes",
]


def _col_letter(idx: int) -> str:
    """Convert 0-based column index to A1 letter(s). Supports beyond Z."""
    letters = ""
    n = idx
    while True:
        letters = chr(ord("A") + n % 26) + letters
        n = n // 26 - 1
        if n < 0:
            break
    return letters


def _subscriber_tier(subs: int) -> str:
    """Human-readable subscriber bucket — useful for sort/filter in the Sheet."""
    if subs >= 5_000_000:
        return "megabrand (5M+)"
    if subs >= 1_000_000:
        return "large (1M-5M)"
    if subs >= 250_000:
        return "mid (250k-1M)"
    if subs >= 50_000:
        return "indie (50k-250k)"
    if subs >= 10_000:
        return "small indie (10k-50k)"
    return "micro (<10k)"


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
        socials = ch.get("socials", {})
        rows.append([
            i,
            ch.get("channel_name", ""),
            ch.get("custom_url", ""),
            ch.get("channel_url", ""),
            ch.get("country", ""),
            ch.get("subscribers", 0),
            _subscriber_tier(ch.get("subscribers", 0)),
            ch.get("total_views", 0),
            ch.get("views_per_sub", 0),
            ch.get("uploads_per_month", 0),
            ch.get("last_upload_date", ""),
            ch.get("days_since_last_upload", ""),
            ch.get("primary_language", ""),
            ch.get("score", 0),
            ch.get("contact_email", ""),
            socials.get("twitter", ""),
            socials.get("instagram", ""),
            socials.get("facebook", ""),
            socials.get("tiktok", ""),
            socials.get("linkedin", ""),
            socials.get("website", ""),
            (ch.get("description_preview") or "")[:280],
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
    col_letter = _col_letter(col_idx)

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
