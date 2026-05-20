#!/usr/bin/env python3
"""Re-scrape emails + socials against an existing Sheet, using whatever
YouTube login cookies are available now (youtube_state.json).

Use case: the main discover.py run produced a Sheet with whatever emails
were extractable anonymously (description-text only). You've since logged
into YouTube and exported cookies via auth_youtube.py. This script
re-extracts against the same channels with the logged-in session and
patches the Sheet in place — no new Sheet, no re-running pitches, no
fresh YouTube API calls.

Usage:
  python rescrape_emails.py --sheet 1O85PVOCjYl9S99Pcn2D6GGq6ucfQBI6O2HuPBSBnjOA
  python rescrape_emails.py --sheet <ID> --top 150       # default
  python rescrape_emails.py --sheet <ID> --top 250       # widen the pass
  python rescrape_emails.py --sheet <ID> --top 250 --force-overwrite

By default we only fill BLANK cells; --force-overwrite replaces existing
values too (useful if the first pass picked up the wrong email).
"""

from __future__ import annotations

import sys
from pathlib import Path

import click
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)

sys.path.insert(0, str(Path(__file__).parent))
from src import email_extractor, sheets as sheets_mod
from src.drive import build_sheets_client


def _read_channel_rows(spreadsheet_id: str) -> tuple[list[str], list[list[str]]]:
    sheets = build_sheets_client()
    resp = sheets.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range="Sheet1!A1:Z1000",
    ).execute()
    values = resp.get("values", [])
    if not values:
        raise RuntimeError("Sheet is empty.")
    headers = values[0]
    rows = values[1:]
    return headers, rows


def _extract_channel_id(channel_url: str) -> str:
    # https://www.youtube.com/channel/UCxxxx → UCxxxx
    return channel_url.rstrip("/").split("/")[-1]


@click.command()
@click.option("--sheet", required=True, help="Spreadsheet ID (the long token in the Sheet URL).")
@click.option("--top", default=150, show_default=True, help="Re-scrape the top N rows.")
@click.option("--force-overwrite", is_flag=True, default=False,
              help="Replace existing email/social values; default only fills blanks.")
def main(sheet: str, top: int, force_overwrite: bool) -> None:
    click.echo(f"📖  Reading Sheet {sheet}...")
    headers, rows = _read_channel_rows(sheet)

    # Map header names → column index (0-based)
    h2i = {name: i for i, name in enumerate(headers)}
    required = ["channel_url", "contact_email", "twitter", "instagram", "facebook", "tiktok", "linkedin", "website"]
    missing = [r for r in required if r not in h2i]
    if missing:
        click.echo(f"❌  Sheet is missing required columns: {missing}")
        sys.exit(1)

    target_rows = rows[:top]
    channel_ids = [_extract_channel_id(r[h2i["channel_url"]]) for r in target_rows]
    click.echo(f"🔁  Re-scraping {len(channel_ids)} channels with current cookies...")

    def on_progress(i, total, cid, email):
        status = email if email else "(no email)"
        click.echo(f"    [{i}/{total}] {cid}: {status}")

    rich = email_extractor.extract_emails_and_socials(
        channel_ids,
        on_progress=on_progress,
    )

    # Build batched cell updates — only writing cells that changed.
    sheets = build_sheets_client()
    updates: list[dict] = []
    cols = {
        "contact_email": h2i["contact_email"],
        "twitter": h2i["twitter"],
        "instagram": h2i["instagram"],
        "facebook": h2i["facebook"],
        "tiktok": h2i["tiktok"],
        "linkedin": h2i["linkedin"],
        "website": h2i["website"],
    }

    n_email_new = n_social_new = 0
    for row_idx, (orig_row, cid) in enumerate(zip(target_rows, channel_ids), start=2):  # row 2 = first data row
        data = rich.get(cid) or {}
        new = {
            "contact_email": data.get("email") or "",
            "twitter": (data.get("socials") or {}).get("twitter", ""),
            "instagram": (data.get("socials") or {}).get("instagram", ""),
            "facebook": (data.get("socials") or {}).get("facebook", ""),
            "tiktok": (data.get("socials") or {}).get("tiktok", ""),
            "linkedin": (data.get("socials") or {}).get("linkedin", ""),
            "website": data.get("website") or "",
        }
        for col_name, col_idx in cols.items():
            new_val = new[col_name]
            old_val = orig_row[col_idx] if col_idx < len(orig_row) else ""
            if not new_val:
                continue
            if old_val and not force_overwrite:
                continue
            if old_val == new_val:
                continue
            updates.append({
                "range": f"Sheet1!{sheets_mod._col_letter(col_idx)}{row_idx}",
                "values": [[new_val]],
            })
            if col_name == "contact_email":
                n_email_new += 1
            else:
                n_social_new += 1

    if not updates:
        click.echo("    No new data to write. Sheet already had everything we scraped.")
        return

    click.echo(f"✏️   Writing {len(updates)} cell updates to Sheet "
               f"({n_email_new} new emails, {n_social_new} new social links)...")
    sheets.spreadsheets().values().batchUpdate(
        spreadsheetId=sheet,
        body={"valueInputOption": "RAW", "data": updates},
    ).execute()
    click.echo("✅  Done.")


if __name__ == "__main__":
    main()
