"""CLI entrypoint: `wc2026-scrape`.

Usage:
    wc2026-scrape                       # full refresh
    wc2026-scrape --dry-run             # plan only, no writes
    wc2026-scrape --source-only fifa    # only refresh FIFA schedule pieces
    wc2026-scrape --source-only wikidata
    wc2026-scrape --source-only wikimedia
    wc2026-scrape --out-dir <path>      # override output directory

Idempotency: re-running with the same upstream snapshot produces
byte-identical JSON. JSON is sorted by key, two-space indented, UTF-8,
trailing newline, deterministic separator.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from .canonical_fixtures import build_canonical_fixtures
from .sources import HttpCache, fetch_fifa_schedule, fetch_wikidata_teams

logger = logging.getLogger("wc2026-scrape")

# Repo-root-relative output dir (from apps/wc2026-data/).
DEFAULT_OUT_DIR = Path(__file__).resolve().parents[3] / "data" / "fifa-wc-2026"
DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"

VALID_SOURCES = ("wikidata", "fifa", "wikimedia")


def write_json(path: Path, data: Any) -> None:
    """Write JSON deterministically — sorted keys, 2-space indent, trailing newline."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    path.write_text(text, encoding="utf-8")


def fixtures_to_json(fixtures: list) -> dict[str, Any]:
    """Wrap the canonical fixture list in the published shape."""
    return {
        "tournament": "FIFA World Cup 2026",
        "match_count": len(fixtures),
        "fixtures": [
            {
                "match_number": f.match_number,
                "stage": f.stage,
                "kickoff_utc": f.kickoff_utc,
                "host_city_id": f.host_city_id,
                "home_team_slot": f.home_team_slot,
                "away_team_slot": f.away_team_slot,
            }
            for f in fixtures
        ],
    }


def build_meta(
    sources_used: list[str],
    cached_only: list[str],
    failed: list[str],
    scrape_date: str,
) -> dict[str, Any]:
    """Build the _meta.json block."""
    return {
        "tournament": "FIFA World Cup 2026",
        "scrape_date": scrape_date,
        "sources": [
            {
                "id": "fifa",
                "name": "FIFA.com — official 2026 World Cup match schedule",
                "url": "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
                "license": "© FIFA — fixture data; no FIFA imagery bundled",
                "used": "fifa" in sources_used,
                "cached_only": "fifa" in cached_only,
                "failed": "fifa" in failed,
            },
            {
                "id": "wikidata",
                "name": "Wikidata SPARQL",
                "url": "https://query.wikidata.org/sparql",
                "license": "CC0",
                "used": "wikidata" in sources_used,
                "cached_only": "wikidata" in cached_only,
                "failed": "wikidata" in failed,
            },
            {
                "id": "wikimedia",
                "name": "Wikimedia Commons (flags + player photos)",
                "url": "https://commons.wikimedia.org",
                "license": "CC-BY / CC-BY-SA / public domain — see per-asset attribution",
                "used": "wikimedia" in sources_used,
                "cached_only": "wikimedia" in cached_only,
                "failed": "wikimedia" in failed,
            },
        ],
        "refresh_policy": {
            "schedule": "weekly via .github/workflows/wc2026-data-refresh.yml",
            "trigger": "GitHub Actions cron + manual dispatch",
            "fallback": "On upstream failure the previous cached snapshot is "
            "preserved and a warning is emitted; never crash the build.",
        },
        "attribution_note": (
            "Flags and player photos sourced from Wikimedia Commons under "
            "CC-BY / CC-BY-SA. Per-asset attribution is preserved in "
            "players.json `attribution` and teams.json `flag_svg_url`. "
            "We bundle no copyrighted FIFA imagery; flags use Wikimedia "
            "Commons assets only."
        ),
    }


def run(out_dir: Path, *, dry_run: bool, source_only: str | None) -> int:
    """Main pipeline.

    Returns 0 on success, non-zero if any data file fails to write.
    """
    cache = HttpCache(DEFAULT_CACHE_DIR)
    sources_used: list[str] = []
    cached_only: list[str] = []
    failed: list[str] = []

    targets = (source_only,) if source_only else VALID_SOURCES

    with httpx.Client() as client:
        if "wikidata" in targets:
            r = fetch_wikidata_teams(client, cache)
            if r.ok:
                sources_used.append("wikidata")
                if r.from_cache:
                    cached_only.append("wikidata")
            else:
                failed.append("wikidata")
        if "fifa" in targets:
            r = fetch_fifa_schedule(client, cache)
            if r.ok:
                sources_used.append("fifa")
                if r.from_cache:
                    cached_only.append("fifa")
            else:
                failed.append("fifa")
        if "wikimedia" in targets:
            sources_used.append("wikimedia")  # resolved client-side; never fails

    fixtures = build_canonical_fixtures()
    fixtures_blob = fixtures_to_json(fixtures)

    scrape_date = datetime.now(UTC).strftime("%Y-%m-%d")
    meta_blob = build_meta(sources_used, cached_only, failed, scrape_date)

    if dry_run:
        logger.info("dry-run: would write fixtures.json (%d matches)", len(fixtures))
        logger.info("dry-run: would write _meta.json (sources=%s, failed=%s)", sources_used, failed)
        return 0

    write_json(out_dir / "fixtures.json", fixtures_blob)
    write_json(out_dir / "_meta.json", meta_blob)
    logger.info(
        "wrote %d fixtures + meta to %s (sources=%s, cached=%s, failed=%s)",
        len(fixtures),
        out_dir,
        sources_used,
        cached_only,
        failed,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint."""
    p = argparse.ArgumentParser(prog="wc2026-scrape")
    p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    p.add_argument("--dry-run", action="store_true", help="Plan only, no writes.")
    p.add_argument(
        "--source-only",
        choices=VALID_SOURCES,
        default=None,
        help="Only refresh from this single source.",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return run(args.out_dir, dry_run=args.dry_run, source_only=args.source_only)


if __name__ == "__main__":
    sys.exit(main())
