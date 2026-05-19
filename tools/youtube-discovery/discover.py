#!/usr/bin/env python3
"""
Tournamental YouTube Channel Discovery Tool

Finds football/soccer YouTube channels across English, Spanish, Portuguese,
and French markets, scores them by reach and engagement, extracts contact
emails, and exports a ranked Google Sheet to Drive.

Usage:
  python discover.py --min-subscribers 10000 --email-extract-top 50
  python discover.py --min-subscribers 10000 --email-extract-top 50 --with-pitches --pitches-top 25
  python discover.py --dry-run
"""

from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

import click
from dotenv import load_dotenv

load_dotenv()

# Add src/ to path
sys.path.insert(0, str(Path(__file__).parent))

from src import youtube, scorer, email_extractor, drive, sheets, docs, pitches


@click.command()
@click.option("--min-subscribers", default=10_000, show_default=True,
              help="Minimum subscriber count to include a channel.")
@click.option("--max-results", default=200, show_default=True,
              help="Maximum total channels to include in the output Sheet.")
@click.option("--email-extract-top", default=50, show_default=True,
              help="Number of top-ranked channels to attempt email extraction on.")
@click.option("--with-pitches", is_flag=True, default=False,
              help="Generate Claude-drafted outreach emails and save as Google Docs.")
@click.option("--pitches-top", default=25, show_default=True,
              help="Number of top channels to generate pitches for (requires --with-pitches).")
@click.option("--dry-run", is_flag=True, default=False,
              help="Print ranked list to stdout only; skip all Drive writes.")
@click.option("--use-cache", is_flag=True, default=False,
              help="Load channels from cache/channels.json instead of re-querying YouTube.")
def main(
    min_subscribers: int,
    max_results: int,
    email_extract_top: int,
    with_pitches: bool,
    pitches_top: int,
    dry_run: bool,
    use_cache: bool,
) -> None:
    _check_env(with_pitches)

    date_str = date.today().isoformat()

    # --- 1. Search / load cache ---
    click.echo("🔍  Searching YouTube...")
    if use_cache:
        cached = youtube.load_cache()
        if cached:
            channel_map = cached
            click.echo(f"    Loaded {len(channel_map)} channels from cache.")
        else:
            click.echo("    No cache found — running fresh search.")
            channel_map = youtube.search_channels()
    else:
        channel_map = youtube.search_channels()

    click.echo(f"    Found {len(channel_map)} unique channels.")

    # --- 2. Fetch stats ---
    click.echo("📊  Fetching channel stats...")
    stats = youtube.fetch_channel_stats(list(channel_map.keys()))

    # Merge language info into stats
    for cid, meta in channel_map.items():
        if cid in stats:
            stats[cid]["primary_language"] = meta["primary_language"]

    # --- 3. Fetch last upload dates ---
    click.echo("📅  Fetching last upload dates...")
    last_uploads = youtube.fetch_last_upload_dates(list(stats.keys()))
    for cid, last_date in last_uploads.items():
        if cid in stats:
            stats[cid]["last_upload_date"] = last_date

    # --- 4. Score and filter ---
    click.echo("⚡  Scoring channels...")
    all_channels = list(stats.values())
    for ch in all_channels:
        ch["score"] = scorer.score_channel(ch)

    filtered = [
        ch for ch in all_channels
        if ch.get("subscribers", 0) >= min_subscribers
    ]
    ranked = sorted(filtered, key=lambda c: c["score"], reverse=True)[:max_results]

    click.echo(f"    {len(ranked)} channels after filtering (min {min_subscribers:,} subs).")

    # Cache for resume on failure
    youtube.save_cache(stats)

    # --- 5. Dry run: print and exit ---
    if dry_run:
        click.echo("\n── DRY RUN — top 20 channels ──")
        for i, ch in enumerate(ranked[:20], 1):
            click.echo(
                f"  {i:3}. {ch['channel_name']:<40} "
                f"subs={ch['subscribers']:>10,}  score={ch['score']}"
            )
        return

    # --- 6. Create Drive folder tree ---
    click.echo("📁  Setting up Google Drive folders...")
    folders = drive.ensure_folder_tree(date_str)

    # --- 7. Create Sheet and write channels ---
    click.echo("📝  Creating Google Sheet...")
    spreadsheet_id = sheets.create_sheet(folders["outreach_id"], date_str)
    sheets.write_channels(spreadsheet_id, ranked)
    sheet_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
    click.echo(f"    Sheet: {sheet_url}")

    # --- 8. Email extraction ---
    if email_extract_top > 0:
        top_for_email = ranked[:email_extract_top]
        click.echo(f"📧  Extracting emails for top {len(top_for_email)} channels (headless browser)...")

        def on_progress(current, total, cid, email):
            status = email if email else "(none)"
            click.echo(f"    [{current}/{total}] {cid}: {status}")

        email_map = email_extractor.extract_emails(
            [ch["channel_id"] for ch in top_for_email],
            on_progress=on_progress,
        )

        # Update channels + Sheet
        email_updates = []
        for i, ch in enumerate(ranked):
            if ch["channel_id"] in email_map:
                ch["contact_email"] = email_map[ch["channel_id"]]
                email_updates.append((i + 1, ch["contact_email"]))  # 1-based row

        sheets.update_column(spreadsheet_id, "contact_email", email_updates)
        click.echo(f"    Emails found: {sum(1 for e in email_map.values() if e)}/{len(top_for_email)}")

    # --- 9. Pitch generation (optional) ---
    if with_pitches:
        top_for_pitches = ranked[:pitches_top]
        click.echo(f"✍️   Generating pitches for top {len(top_for_pitches)} channels...")

        pitch_updates = []
        for i, ch in enumerate(top_for_pitches, 1):
            click.echo(f"    [{i}/{len(top_for_pitches)}] {ch['channel_name']}")
            try:
                video_titles = youtube.fetch_recent_video_titles(ch["channel_id"])
                pitch_body = pitches.generate_pitch(ch, video_titles)
                doc_url = docs.create_pitch_doc(
                    ch["channel_name"], pitch_body, folders["pitches_id"]
                )
                ch["pitch_doc_link"] = doc_url
                row_num = ranked.index(ch) + 1
                pitch_updates.append((row_num, doc_url))
            except Exception as e:
                click.echo(f"    [warn] pitch failed for {ch['channel_name']}: {e}")

        sheets.update_column(spreadsheet_id, "pitch_doc_link", pitch_updates)

    # --- Done ---
    click.echo("\n✅  Done.")
    click.echo(f"    Sheet: {sheet_url}")
    click.echo(f"    Folder: https://drive.google.com/drive/folders/{folders['outreach_id']}")


def _check_env(with_pitches: bool) -> None:
    missing = []
    if not os.environ.get("YOUTUBE_API_KEY"):
        missing.append("YOUTUBE_API_KEY")
    if not os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON"):
        missing.append("GOOGLE_SERVICE_ACCOUNT_JSON")
    if with_pitches and not os.environ.get("ANTHROPIC_API_KEY"):
        missing.append("ANTHROPIC_API_KEY (required for --with-pitches)")
    if missing:
        click.echo("❌  Missing required env vars:\n" + "\n".join(f"   {m}" for m in missing))
        sys.exit(1)


if __name__ == "__main__":
    main()
