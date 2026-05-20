#!/usr/bin/env python3
"""Regenerate pitch Google Docs against an existing Sheet.

Use case: discover.py produced a Sheet but pitch generation failed
(e.g. wrong auth, model issues, dead channels in top-N). This script:

1. Reads the existing Sheet,
2. Filters to *active* channels (recent upload + reasonable cadence),
3. Picks the top --top by score,
4. Fetches recent video titles per channel (1 YT quota unit each),
5. Drafts a pitch via the local `claude` CLI (Max Plan, no API credits),
6. Creates one Google Doc per channel in the Pitches folder,
7. Patches the pitch_doc_link column.

Existing pitch_doc_link cells are skipped unless --force.

Usage:
  python regen_pitches.py --sheet 1O85PVOCjYl9S99Pcn2D6GGq6ucfQBI6O2HuPBSBnjOA
  python regen_pitches.py --sheet <ID> --top 25 --max-days-since-upload 60
  python regen_pitches.py --sheet <ID> --force                  # rewrite existing pitches
"""

from __future__ import annotations

import sys
from pathlib import Path

import click
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)

sys.path.insert(0, str(Path(__file__).parent))
from src import youtube, pitches as pitches_mod, docs as docs_mod, sheets as sheets_mod, drive


def _read(spreadsheet_id: str) -> tuple[list[str], list[list[str]]]:
    sheets = drive.build_sheets_client()
    resp = sheets.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range="Sheet1!A1:Z1000",
    ).execute()
    values = resp.get("values", [])
    if not values:
        raise RuntimeError("Sheet is empty.")
    return values[0], values[1:]


def _channel_id_from_url(url: str) -> str:
    return url.rstrip("/").split("/")[-1]


@click.command()
@click.option("--sheet", required=True, help="Spreadsheet ID.")
@click.option("--top", default=25, show_default=True, help="Pitch the top N (by score) active channels.")
@click.option("--max-days-since-upload", default=60, show_default=True,
              help="Skip channels whose last upload is older than this many days.")
@click.option("--min-uploads-per-month", default=1.0, show_default=True,
              help="Skip channels averaging fewer than this many uploads/month.")
@click.option("--force", is_flag=True, default=False,
              help="Regenerate pitches even when pitch_doc_link is already filled.")
def main(sheet: str, top: int, max_days_since_upload: int,
         min_uploads_per_month: float, force: bool) -> None:

    headers, rows = _read(sheet)
    h2i = {n: i for i, n in enumerate(headers)}
    required = ["channel_name", "channel_url", "score", "primary_language",
                "subscribers", "country", "description_preview",
                "days_since_last_upload",
                "uploads_per_month", "pitch_doc_link"]
    missing = [r for r in required if r not in h2i]
    if missing:
        click.echo(f"❌  Sheet is missing required columns: {missing}")
        sys.exit(1)

    def _parse_int(s, default=None):
        try:
            return int(str(s).replace(",", ""))
        except (ValueError, TypeError):
            return default

    def _parse_float(s, default=0.0):
        try:
            return float(str(s).replace(",", ""))
        except (ValueError, TypeError):
            return default

    # Hydrate rows into structured dicts; track original row index for the patch.
    channels: list[tuple[int, dict]] = []
    for row_idx, row in enumerate(rows, start=2):  # +1 for header + 1-indexed
        def _g(col):
            i = h2i[col]
            return row[i] if i < len(row) else ""
        days = _parse_int(_g("days_since_last_upload"))
        upm = _parse_float(_g("uploads_per_month"))
        if max_days_since_upload > 0:
            if days is None or days > max_days_since_upload:
                continue
        if min_uploads_per_month > 0 and upm < min_uploads_per_month:
            continue
        if not force and _g("pitch_doc_link"):
            continue
        channels.append((row_idx, {
            "channel_id": _channel_id_from_url(_g("channel_url")),
            "channel_name": _g("channel_name"),
            "subscribers": _parse_int(_g("subscribers"), 0) or 0,
            "primary_language": _g("primary_language") or "en",
            "country": _g("country") or "",
            "description_preview": _g("description_preview"),
            "score": _parse_float(_g("score")),
        }))

    channels.sort(key=lambda t: t[1]["score"], reverse=True)
    targets = channels[:top]
    if not targets:
        click.echo("No active channels matched the filters. Nothing to do.")
        return
    click.echo(f"🎯  Pitching top {len(targets)} active channels.")

    # Need the YouTube Outreach > Pitches folder ID. Easiest: find it under
    # 'Tournamental GTM' in Drive root (or the parent specified in .env).
    from datetime import date
    folders = drive.ensure_folder_tree(date.today().isoformat())
    pitches_folder_id = folders["pitches_id"]

    sheets = drive.build_sheets_client()
    patch_data: list[dict] = []
    for i, (row_idx, ch) in enumerate(targets, start=1):
        click.echo(f"    [{i}/{len(targets)}] {ch['channel_name']} ({ch['primary_language']})")
        try:
            titles = youtube.fetch_recent_video_titles(ch["channel_id"])
            body = pitches_mod.generate_pitch(ch, titles)
            doc_url = docs_mod.create_pitch_doc(
                ch["channel_name"], body, pitches_folder_id,
                language=ch["primary_language"],
            )
            col_letter = sheets_mod._col_letter(h2i["pitch_doc_link"])
            patch_data.append({
                "range": f"Sheet1!{col_letter}{row_idx}",
                "values": [[doc_url]],
            })
        except Exception as e:
            click.echo(f"      [warn] {ch['channel_name']}: {e}")

    if patch_data:
        sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet,
            body={"valueInputOption": "RAW", "data": patch_data},
        ).execute()
        click.echo(f"✅  Patched {len(patch_data)} pitch_doc_link cells.")
    else:
        click.echo("⚠️   No pitches were created; nothing patched.")


if __name__ == "__main__":
    main()
