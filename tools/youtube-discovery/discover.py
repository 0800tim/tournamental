#!/usr/bin/env python3
"""
Tournamental YouTube Channel Discovery Tool

Finds football/soccer YouTube channels across English, Spanish, Portuguese,
and French markets, scores them by reach and engagement, extracts contact
emails + socials, and exports a ranked Google Sheet to Drive. Can also
draft personalised pitch emails via the local Claude Code CLI.

Usage:
  python discover.py --dry-run
  python discover.py --max-subscribers 1000000 --max-results 500 \
                     --email-extract-top 150 --with-pitches --pitches-top 25
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import click
from dotenv import load_dotenv

load_dotenv(override=True)

# Add src/ to path
sys.path.insert(0, str(Path(__file__).parent))

from src import youtube, scorer, email_extractor, drive, sheets, docs, pitches


def _fresh_fetch() -> dict[str, dict]:
    """Run search -> channel stats -> last-upload-dates from scratch."""
    click.echo("Searching YouTube...")
    channel_map = youtube.search_channels()
    click.echo(f"    Found {len(channel_map)} unique channels.")

    click.echo("Fetching channel stats (1 quota unit per 50 channels)...")
    stats = youtube.fetch_channel_stats(list(channel_map.keys()))
    for cid, meta in channel_map.items():
        if cid in stats:
            stats[cid]["primary_language"] = meta["primary_language"]

    click.echo("Fetching last upload dates (1 quota unit per channel)...")
    last_uploads = youtube.fetch_last_upload_dates(stats)
    for cid, last_date in last_uploads.items():
        if cid in stats:
            stats[cid]["last_upload_date"] = last_date

    return stats


@click.command()
@click.option("--min-subscribers", default=10_000, show_default=True,
              help="Minimum subscriber count to include a channel.")
@click.option("--max-subscribers", default=0, show_default=True,
              help="Maximum subscriber count (0 = no cap). Use ~1_000_000 to exclude megabrands and bias toward indies.")
@click.option("--max-days-since-upload", default=60, show_default=True,
              help="Drop channels whose last upload is older than this many days. 0 = no cap. Default 60 = posted within the last 2 months.")
@click.option("--min-uploads-per-month", default=1.0, show_default=True,
              help="Drop channels averaging fewer than this many uploads per month over their lifetime. 0 = no floor.")
@click.option("--max-results", default=500, show_default=True,
              help="Maximum total channels to include in the output Sheet.")
@click.option("--email-extract-top", default=150, show_default=True,
              help="Number of top-ranked channels to attempt email + social extraction on.")
@click.option("--with-pitches", is_flag=True, default=False,
              help="Generate Claude-drafted outreach emails via the local `claude` CLI (Max Plan).")
@click.option("--pitches-top", default=25, show_default=True,
              help="Number of top channels to generate pitches for (requires --with-pitches).")
@click.option("--dry-run", is_flag=True, default=False,
              help="Print ranked list to stdout only; skip all Drive writes.")
@click.option("--use-cache", is_flag=True, default=False,
              help="Load channels from cache/channels.json instead of re-querying YouTube.")
def main(
    min_subscribers: int,
    max_subscribers: int,
    max_days_since_upload: int,
    min_uploads_per_month: float,
    max_results: int,
    email_extract_top: int,
    with_pitches: bool,
    pitches_top: int,
    dry_run: bool,
    use_cache: bool,
) -> None:
    _check_env(with_pitches, dry_run)

    date_str = date.today().isoformat()

    # --- 1. Search / load cache ---
    if use_cache:
        cached = youtube.load_cache()
        if cached and any(c.get("subscribers", 0) > 0 for c in cached.values()):
            click.echo(f"Loaded {len(cached)} channels from cache (skipping YouTube search).")
            stats = cached
            youtube.backfill_snippet_fields(stats)
        else:
            click.echo("    No usable cache found -- running fresh search.")
            stats = _fresh_fetch()
    else:
        stats = _fresh_fetch()

    # Derive days_since_last_upload for every channel (no API needed).
    today = datetime.now(timezone.utc)
    for ch in stats.values():
        last = ch.get("last_upload_date", "")
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                ch["days_since_last_upload"] = (today - last_dt).days
            except ValueError:
                ch["days_since_last_upload"] = ""
        else:
            ch["days_since_last_upload"] = ""

    # --- 2. Score and filter ---
    click.echo("Scoring channels...")
    all_channels = list(stats.values())
    for ch in all_channels:
        ch["score"] = scorer.score_channel(ch)

    def _is_active(ch: dict) -> bool:
        days = ch.get("days_since_last_upload")
        if max_days_since_upload > 0:
            if days == "" or days is None or (isinstance(days, int) and days > max_days_since_upload):
                return False
        if min_uploads_per_month > 0 and ch.get("uploads_per_month", 0) < min_uploads_per_month:
            return False
        return True

    pre_active = [
        ch for ch in all_channels
        if ch.get("subscribers", 0) >= min_subscribers
        and (max_subscribers == 0 or ch.get("subscribers", 0) <= max_subscribers)
    ]
    filtered = [ch for ch in pre_active if _is_active(ch)]
    dropped_inactive = len(pre_active) - len(filtered)

    ranked = sorted(filtered, key=lambda c: c["score"], reverse=True)[:max_results]

    sub_filter_desc = f"min {min_subscribers:,}"
    if max_subscribers > 0:
        sub_filter_desc += f", max {max_subscribers:,}"
    activity_desc = []
    if max_days_since_upload > 0:
        activity_desc.append(f"posted within {max_days_since_upload}d")
    if min_uploads_per_month > 0:
        activity_desc.append(f">={min_uploads_per_month:g} uploads/month lifetime avg")
    activity_str = "; ".join(activity_desc) if activity_desc else "no activity filter"
    click.echo(
        f"    {len(ranked)} channels after filtering "
        f"({sub_filter_desc} subs; {activity_str}; "
        f"dropped {dropped_inactive} inactive)."
    )

    # Only cache when we actually have non-empty data; never overwrite a good
    # cache with a quota-failed run.
    if any(c.get("subscribers", 0) > 0 for c in stats.values()):
        youtube.save_cache(stats)

    if dry_run:
        click.echo("\n--- DRY RUN -- top 20 channels ---")
        for i, ch in enumerate(ranked[:20], 1):
            click.echo(
                f"  {i:3}. {ch['channel_name']:<40} "
                f"subs={ch['subscribers']:>10,}  score={ch['score']}"
            )
        return

    # --- 3. Create Drive folder tree ---
    click.echo("Setting up Google Drive folders...")
    folders = drive.ensure_folder_tree(date_str)

    # --- 4. Create Sheet (initial write happens after extraction so the rich
    #         email/social data lands in the first write, not a backfill). ---
    click.echo("Creating Google Sheet...")
    spreadsheet_id = sheets.create_sheet(folders["outreach_id"], date_str)
    sheets.write_channels(spreadsheet_id, ranked)
    sheet_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit"
    click.echo(f"    Sheet: {sheet_url}")

    # --- 5. Email + social link extraction (single Playwright pass per channel) ---
    if email_extract_top > 0:
        top_for_extract = ranked[:email_extract_top]
        click.echo(f"Scraping emails + socials for top {len(top_for_extract)} channels...")

        def on_progress(current, total, cid, email):
            status = email if email else "(no email)"
            click.echo(f"    [{current}/{total}] {cid}: {status}")

        rich = email_extractor.extract_emails_and_socials(
            [ch["channel_id"] for ch in top_for_extract],
            on_progress=on_progress,
        )

        for ch in ranked:
            data = rich.get(ch["channel_id"])
            if not data:
                continue
            if data.get("email"):
                ch["contact_email"] = data["email"]
            socials = dict(data.get("socials") or {})
            if data.get("website"):
                socials["website"] = data["website"]
            ch["socials"] = socials

        # Re-write all rows with enriched data instead of patching cells.
        sheets.write_channels(spreadsheet_id, ranked)

        email_hits = sum(1 for d in rich.values() if d.get("email"))
        social_hits = sum(1 for d in rich.values() if d.get("socials") or d.get("website"))
        click.echo(
            f"    Emails found: {email_hits}/{len(top_for_extract)}; "
            f"social/website links: {social_hits}/{len(top_for_extract)}"
        )

    # --- 6. Pitch generation (optional) ---
    if with_pitches:
        top_for_pitches = ranked[:pitches_top]
        click.echo(f"Generating pitches for top {len(top_for_pitches)} channels...")

        pitch_updates = []
        for i, ch in enumerate(top_for_pitches, 1):
            click.echo(f"    [{i}/{len(top_for_pitches)}] {ch['channel_name']}")
            try:
                video_titles = youtube.fetch_recent_video_titles(ch["channel_id"])
                pitch_body = pitches.generate_pitch(ch, video_titles)
                doc_url = docs.create_pitch_doc(
                    ch["channel_name"],
                    pitch_body,
                    folders["pitches_id"],
                    language=ch.get("primary_language", "en"),
                )
                ch["pitch_doc_link"] = doc_url
                row_num = ranked.index(ch) + 1
                pitch_updates.append((row_num, doc_url))
            except Exception as e:
                click.echo(f"    [warn] pitch failed for {ch['channel_name']}: {e}")

        sheets.update_column(spreadsheet_id, "pitch_doc_link", pitch_updates)

    click.echo("\nDone.")
    click.echo(f"    Sheet: {sheet_url}")
    click.echo(f"    Folder: https://drive.google.com/drive/folders/{folders['outreach_id']}")


def _check_env(with_pitches: bool, dry_run: bool) -> None:
    missing = []
    if not (os.environ.get("YOUTUBE_API_KEYS") or os.environ.get("YOUTUBE_API_KEY")):
        missing.append("YOUTUBE_API_KEYS (or YOUTUBE_API_KEY)")
    if not dry_run:
        if not os.environ.get("GOOGLE_OAUTH_CLIENT_ID"):
            missing.append("GOOGLE_OAUTH_CLIENT_ID")
        if not os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET"):
            missing.append("GOOGLE_OAUTH_CLIENT_SECRET")
    if missing:
        click.echo("Missing required env vars:\n" + "\n".join(f"   {m}" for m in missing))
        sys.exit(1)

    if with_pitches:
        import shutil
        if not shutil.which(os.environ.get("CLAUDE_BIN", "claude")):
            click.echo(
                "--with-pitches requires the `claude` CLI on PATH.\n"
                "    Install Claude Code, run `claude` once interactively to authenticate, then retry."
            )
            sys.exit(1)


if __name__ == "__main__":
    main()
