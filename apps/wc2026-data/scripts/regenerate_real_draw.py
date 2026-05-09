#!/usr/bin/env python3
"""Regenerate the four 2026 FIFA WC data files from the real-draw snapshot.

Outputs (deterministic, sorted-keys JSON, two-space indent, trailing nl):
- data/fifa-wc-2026/teams.json
- data/fifa-wc-2026/fixtures.json
- data/fifa-wc-2026/_meta.json
- packages/bracket-engine/data/fifa-wc-2026-fixtures.json (12-of-4 shape)

Usage:
    uv run python scripts/regenerate_real_draw.py
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
APP = ROOT / "apps" / "wc2026-data"
DATA_DIR = ROOT / "data" / "fifa-wc-2026"
BRACKET_DIR = ROOT / "packages" / "bracket-engine" / "data"

# Allow `from wc2026_data...` imports when running this script directly.
sys.path.insert(0, str(APP / "src"))

from wc2026_data.canonical_fixtures import (  # noqa: E402
    GROUP_TEAMS_CLEAN,
    build_canonical_fixtures,
)
from wc2026_data.sources_real import (  # noqa: E402
    DROPPED_TEAM_CODES,
    MANUAL_SNAPSHOT_DATE,
    NEW_TEAM_METADATA,
)


def write_json(path: Path, data: Any) -> None:
    """Deterministic JSON write — sorted keys, 2-space indent, trailing nl."""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. teams.json
# ---------------------------------------------------------------------------


def regenerate_teams_json() -> None:
    """Drop placeholders + non-qualifiers, splice in the 10 new real teams."""
    src = json.loads((DATA_DIR / "teams.json").read_text(encoding="utf-8"))

    # Filter old roster.
    kept = [t for t in src["teams"] if t["code"] not in DROPPED_TEAM_CODES]

    existing_codes = {t["code"] for t in kept}

    # Splice in the new teams (idempotent: skip if already present).
    for code, meta in NEW_TEAM_METADATA.items():
        if code in existing_codes:
            continue
        kept.append({
            "code": code,
            "name": meta["name"],
            "short_name": meta["short_name"],
            "confederation": meta["confederation"],
            "flag_emoji": meta["flag_emoji"],
            "flag_svg_url": meta["flag_svg_url"],
            "kit": meta["kit"],
            "fifa_ranking_at_2026": meta["fifa_ranking_at_2026"],
            "manager": meta["manager"],
            "wikidata_q": meta["wikidata_q"],
            "qualified": True,
            "qualification_path": meta["qualification_path"],
        })

    # Mark all retained teams as qualified=True (Italy/Wales lost play-offs).
    for t in kept:
        t["qualified"] = True
        # Drop the "_note" field that previously flagged provisional status.
        t.pop("_note", None)

    # Sort by code, deterministic.
    kept.sort(key=lambda t: t["code"])

    if len(kept) != 48:
        raise RuntimeError(f"expected 48 teams, got {len(kept)}")

    blob = {
        "$schema": "./schema/teams.schema.json",
        "tournament": "FIFA World Cup 2026",
        "_note": (
            "48 confirmed teams from the FIFA Final Draw "
            f"(Kennedy Center, Washington D.C., 5 December 2025) plus the "
            "March 2026 UEFA + intercontinental play-off winners. Source "
            f"snapshot: {MANUAL_SNAPSHOT_DATE}. "
            "fifa_ranking_at_2026 is a best estimate as of scrape date in "
            "_meta.json. Teams are sorted by code."
        ),
        "teams": kept,
    }
    write_json(DATA_DIR / "teams.json", blob)
    print(f"  wrote teams.json  ({len(kept)} teams)")


# ---------------------------------------------------------------------------
# 2. fixtures.json (data/fifa-wc-2026/)
# ---------------------------------------------------------------------------


def regenerate_fixtures_json() -> None:
    """Build canonical fixtures from updated GROUP_TEAMS_CLEAN."""
    fixtures = build_canonical_fixtures()
    if len(fixtures) != 104:
        raise RuntimeError(f"expected 104 fixtures, got {len(fixtures)}")

    blob = {
        "$schema": "./schema/fixtures.schema.json",
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
    write_json(DATA_DIR / "fixtures.json", blob)
    print(f"  wrote fixtures.json  ({len(fixtures)} matches)")


# ---------------------------------------------------------------------------
# 3. _meta.json
# ---------------------------------------------------------------------------


def regenerate_meta_json() -> None:
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    blob = {
        "tournament": "FIFA World Cup 2026",
        "scrape_date": today,
        "sources": [
            {
                "id": "wikipedia_groups",
                "name": "Wikipedia per-group articles (2026 FIFA World Cup Group A-L)",
                "url": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
                "license": "CC BY-SA 4.0",
                "used": True,
                "cached_only": False,
                "failed": False,
            },
            {
                "id": "wikipedia_qualification",
                "name": "Wikipedia: 2026 FIFA World Cup qualification (play-off winners)",
                "url": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_qualification",
                "license": "CC BY-SA 4.0",
                "used": True,
                "cached_only": False,
                "failed": False,
            },
            {
                "id": "fifa",
                "name": "FIFA.com — official 2026 World Cup match schedule",
                "url": "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
                "license": "© FIFA — fixture data; no FIFA imagery bundled",
                "used": True,
                "cached_only": False,
                "failed": False,
            },
            {
                "id": "wikidata",
                "name": "Wikidata SPARQL",
                "url": "https://query.wikidata.org/sparql",
                "license": "CC0",
                "used": True,
                "cached_only": False,
                "failed": False,
            },
            {
                "id": "wikimedia",
                "name": "Wikimedia Commons (flags + player photos)",
                "url": "https://commons.wikimedia.org",
                "license": "CC-BY / CC-BY-SA / public domain — see per-asset attribution",
                "used": True,
                "cached_only": False,
                "failed": False,
            },
        ],
        "refresh_policy": {
            "schedule": "weekly via .github/workflows/wc2026-data-refresh.yml",
            "trigger": "GitHub Actions cron + manual dispatch",
            "fallback": (
                "On upstream failure the previous cached snapshot is preserved "
                "and a warning is emitted; never crash the build. Real-draw "
                "fall-back is the manually-curated snapshot in "
                "wc2026_data.sources_real.MANUAL_DRAW_SNAPSHOT."
            ),
        },
        "attribution_note": (
            "Real-draw composition sourced from the per-group Wikipedia "
            "articles for the 2026 FIFA World Cup (CC BY-SA 4.0). "
            "Flags and player photos sourced from Wikimedia Commons under "
            "CC-BY / CC-BY-SA. Per-asset attribution is preserved in "
            "players.json `attribution` and teams.json `flag_svg_url`. "
            "We bundle no copyrighted FIFA imagery; flags use Wikimedia "
            "Commons assets only."
        ),
        "draw_resolution": {
            "draw_event": "FIFA Final Draw",
            "draw_location": "Kennedy Center, Washington, D.C.",
            "draw_date": "2025-12-05",
            "playoff_resolution_window": "March 2026",
            "uefa_playoff_winners": ["BIH", "SWE", "TUR", "CZE"],
            "intercontinental_playoff_winners": ["COD", "IRQ"],
        },
    }
    write_json(DATA_DIR / "_meta.json", blob)
    print("  wrote _meta.json")


# ---------------------------------------------------------------------------
# 4. players.json — drop seed-roster entries for non-qualifying teams.
# ---------------------------------------------------------------------------


def regenerate_players_json() -> None:
    src = json.loads((DATA_DIR / "players.json").read_text(encoding="utf-8"))
    before = len(src["players"])
    kept = [p for p in src["players"] if p["country"] not in DROPPED_TEAM_CODES]
    src["players"] = kept
    write_json(DATA_DIR / "players.json", src)
    print(f"  wrote players.json  ({len(kept)} players, dropped {before - len(kept)})")


# ---------------------------------------------------------------------------
# 5. bracket-engine/data/fifa-wc-2026-fixtures.json
# ---------------------------------------------------------------------------


def _implied_for(rank: int | None, n_teams: int = 48) -> float:
    if rank is None:
        return round(1.0 / n_teams, 4)
    return round(0.22 * (0.93 ** (rank - 1)), 4)


def regenerate_bracket_engine_fixtures() -> None:
    """12 groups of 4, real teams, declarative knockout slot graph."""
    teams_blob = json.loads((DATA_DIR / "teams.json").read_text(encoding="utf-8"))
    cities_blob = json.loads((DATA_DIR / "host-cities.json").read_text(encoding="utf-8"))

    cities_by_id = {c["id"]: c for c in cities_blob["host_cities"]}

    # Teams in the bracket-engine shape, sorted by code (deterministic).
    bracket_teams = []
    for t in sorted(teams_blob["teams"], key=lambda t: t["code"]):
        bracket_teams.append({
            "id": t["code"],
            "name": t["name"],
            "country": t["code"],
            "fifa_rank": t["fifa_ranking_at_2026"] or 999,
            "pre_tournament_implied_win": _implied_for(t["fifa_ranking_at_2026"]),
            "placeholder": False,
        })

    # Groups: 12 groups, each with 4 team_ids in canonical (FIFA seeding) order.
    groups = [
        {"id": letter, "team_ids": list(GROUP_TEAMS_CLEAN[letter])}
        for letter in "ABCDEFGHIJKL"
    ]

    # Group fixtures: 72 matches, 6 per group. Build them from the same
    # canonical builder so this file is byte-aligned to data/fifa-wc-2026.
    fix_by_match: dict[int, Any] = {f.match_number: f for f in build_canonical_fixtures()}

    group_fixtures = []
    for f in [x for x in fix_by_match.values() if x.stage.startswith("group_")]:
        letter = f.stage.split("_")[1].upper()
        team_ids = GROUP_TEAMS_CLEAN[letter]
        try:
            h_idx = team_ids.index(f.home_team_slot)
            a_idx = team_ids.index(f.away_team_slot)
        except ValueError as exc:
            msg = (
                f"could not map {f.home_team_slot}/{f.away_team_slot} "
                f"into group {letter}"
            )
            raise RuntimeError(msg) from exc

        group_fixtures.append({
            "match_no": f.match_number,
            "group_id": letter,
            "home_idx": h_idx,
            "away_idx": a_idx,
            "kickoff_utc": f.kickoff_utc,
            "host": cities_by_id[f.host_city_id]["country"],
            "venue": cities_by_id[f.host_city_id]["stadium"],
        })

    # Knockouts. R32 dependency pairings (FIFA-published bracket).
    r32_slots = [
        ("1A", "2C"), ("1B", "2F"), ("1C", "2A"), ("1D", "2E"),
        ("1E", "2D"), ("1F", "2B"), ("1G", "2H"), ("1H", "2G"),
        ("1I", "2L"), ("1J", "2K"), ("1K", "2J"), ("1L", "2I"),
        ("3A", "3D"), ("3B", "3E"), ("3C", "3F"), ("3G", "3H"),
    ]

    all_groups = list("ABCDEFGHIJKL")
    best_third_counter = {"n": 0}

    def parse_slot(spec: str) -> dict[str, Any]:
        if spec.startswith("3"):
            best_third_counter["n"] += 1
            return {
                "kind": "best_third",
                "rank": best_third_counter["n"],
                "eligible_groups": all_groups,
            }
        pos = int(spec[0])
        grp = spec[1]
        return {"kind": "group_position", "group": grp, "position": pos}

    knockouts = []

    for i, (h, a) in enumerate(r32_slots):
        match_no = 73 + i
        f = fix_by_match[match_no]
        knockouts.append({
            "id": f"r32_{i + 1:02d}",
            "stage": "r32",
            "match_no": match_no,
            "home": parse_slot(h),
            "away": parse_slot(a),
            "kickoff_utc": f.kickoff_utc,
            "host": cities_by_id[f.host_city_id]["country"],
            "venue": cities_by_id[f.host_city_id]["stadium"],
        })

    for i in range(8):
        match_no = 89 + i
        f = fix_by_match[match_no]
        knockouts.append({
            "id": f"r16_{i + 1:02d}",
            "stage": "r16",
            "match_no": match_no,
            "home": {"kind": "knockout_winner", "match_id": f"r32_{2 * i + 1:02d}"},
            "away": {"kind": "knockout_winner", "match_id": f"r32_{2 * i + 2:02d}"},
            "kickoff_utc": f.kickoff_utc,
            "host": cities_by_id[f.host_city_id]["country"],
            "venue": cities_by_id[f.host_city_id]["stadium"],
        })

    for i in range(4):
        match_no = 97 + i
        f = fix_by_match[match_no]
        knockouts.append({
            "id": f"qf_{i + 1:02d}",
            "stage": "qf",
            "match_no": match_no,
            "home": {"kind": "knockout_winner", "match_id": f"r16_{2 * i + 1:02d}"},
            "away": {"kind": "knockout_winner", "match_id": f"r16_{2 * i + 2:02d}"},
            "kickoff_utc": f.kickoff_utc,
            "host": cities_by_id[f.host_city_id]["country"],
            "venue": cities_by_id[f.host_city_id]["stadium"],
        })

    for i in range(2):
        match_no = 101 + i
        f = fix_by_match[match_no]
        knockouts.append({
            "id": f"sf_{i + 1:02d}",
            "stage": "sf",
            "match_no": match_no,
            "home": {"kind": "knockout_winner", "match_id": f"qf_{2 * i + 1:02d}"},
            "away": {"kind": "knockout_winner", "match_id": f"qf_{2 * i + 2:02d}"},
            "kickoff_utc": f.kickoff_utc,
            "host": cities_by_id[f.host_city_id]["country"],
            "venue": cities_by_id[f.host_city_id]["stadium"],
        })

    # Third-place play-off — match 103. Convention (matching the previous
    # placeholder): id "tp_01", stage "sf" so the score-multiplier table
    # treats it like the semis it sources from.
    f_tp = fix_by_match[103]
    knockouts.append({
        "id": "tp_01",
        "stage": "sf",
        "match_no": 103,
        "home": {"kind": "knockout_loser", "match_id": "sf_01"},
        "away": {"kind": "knockout_loser", "match_id": "sf_02"},
        "kickoff_utc": f_tp.kickoff_utc,
        "host": cities_by_id[f_tp.host_city_id]["country"],
        "venue": cities_by_id[f_tp.host_city_id]["stadium"],
    })

    f_final = fix_by_match[104]
    knockouts.append({
        "id": "final",
        "stage": "f",
        "match_no": 104,
        "home": {"kind": "knockout_winner", "match_id": "sf_01"},
        "away": {"kind": "knockout_winner", "match_id": "sf_02"},
        "kickoff_utc": f_final.kickoff_utc,
        "host": cities_by_id[f_final.host_city_id]["country"],
        "venue": cities_by_id[f_final.host_city_id]["stadium"],
    })

    bracket_blob = {
        "_meta": {
            "source": "Wikipedia per-group articles + FIFA Final Draw 2025-12-05",
            "source_url": "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
            "schedule_status": "official",
            "fetched_at_utc": "2026-05-09T00:00:00Z",
            "notes": (
                "12 groups of 4 (FIFA-official 2026 format). 72 group "
                "matches + 16 R32 + 8 R16 + 4 QF + 2 SF + 1 third-place + "
                "1 final = 32 knockouts; total 104 matches. Group "
                "composition reflects the real Final Draw "
                "(Kennedy Center, Washington D.C., 5 December 2025) and "
                "the March 2026 UEFA + intercontinental play-off winners."
            ),
        },
        "id": "fifa-wc-2026",
        "name": "FIFA World Cup 2026 (US / Canada / Mexico)",
        "start_utc": fix_by_match[1].kickoff_utc,
        "final_utc": fix_by_match[104].kickoff_utc,
        "teams": bracket_teams,
        "groups": groups,
        "group_fixtures": group_fixtures,
        "knockouts": knockouts,
        "advancement": {
            "automatic_per_group": 2,
            "wildcard_third": 8,
            "wildcard_fourth": 0,
        },
    }
    write_json(BRACKET_DIR / "fifa-wc-2026-fixtures.json", bracket_blob)
    print(
        f"  wrote bracket-engine fixtures  "
        f"({len(bracket_teams)} teams, {len(groups)} groups, "
        f"{len(group_fixtures)} group matches, {len(knockouts)} knockout slots)"
    )


def main() -> int:
    print("Regenerating WC 2026 data from real-draw snapshot...")
    regenerate_teams_json()
    regenerate_fixtures_json()
    regenerate_meta_json()
    regenerate_players_json()
    regenerate_bracket_engine_fixtures()
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
