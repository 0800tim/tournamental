"""StatsBomb open-data file loader.

Reads JSON files from a local clone of github.com/statsbomb/open-data.
Resolves the AR-FR 2022 World Cup Final to its match_id and exposes the
relevant lineup, event, and 360 freeze-frame data.

If a local clone is not present the loader can transparently fall back to
fetching the four required JSON files (competitions, matches, lineups,
events, three-sixty) from raw.githubusercontent.com and caching them under
``<statsbomb_data>/data/...``.
"""
from __future__ import annotations

import json
import logging
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import (
    DEFAULT_COMPETITION_ID,
    DEFAULT_MATCH_DATE,
    DEFAULT_SEASON_ID,
)

log = logging.getLogger(__name__)

RAW_BASE = "https://raw.githubusercontent.com/statsbomb/open-data/master"


@dataclass
class MatchData:
    match_id: int
    match_meta: dict[str, Any]
    lineups: list[dict[str, Any]]
    events: list[dict[str, Any]]
    three_sixty: list[dict[str, Any]]


def _read_or_fetch(local: Path, remote_path: str, allow_fetch: bool) -> Any:
    if local.exists():
        with local.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    if not allow_fetch:
        raise FileNotFoundError(
            f"{local} not found and remote fetch disabled. "
            "Pass --allow-fetch or clone github.com/statsbomb/open-data."
        )
    log.info("fetching %s", remote_path)
    local.parent.mkdir(parents=True, exist_ok=True)
    url = f"{RAW_BASE}{remote_path}"
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = resp.read()
    local.write_bytes(body)
    return json.loads(body.decode("utf-8"))


def resolve_match_id(
    statsbomb_data: Path,
    *,
    competition_id: int = DEFAULT_COMPETITION_ID,
    season_id: int = DEFAULT_SEASON_ID,
    match_date: str = DEFAULT_MATCH_DATE,
    home_team: str = "Argentina",
    away_team: str = "France",
    allow_fetch: bool = True,
) -> int:
    """Locate the StatsBomb match_id for the AR-FR final (or other matches).

    Scans ``data/matches/<comp>/<season>.json`` for a record whose date and
    team names match.
    """
    matches_path = statsbomb_data / "data" / "matches" / str(competition_id) / f"{season_id}.json"
    matches = _read_or_fetch(
        matches_path,
        f"/data/matches/{competition_id}/{season_id}.json",
        allow_fetch=allow_fetch,
    )
    for m in matches:
        if m.get("match_date") != match_date:
            continue
        home = m.get("home_team", {}).get("home_team_name")
        away = m.get("away_team", {}).get("away_team_name")
        if home == home_team and away == away_team:
            return int(m["match_id"])
    raise LookupError(
        f"no match found for {home_team} vs {away_team} on {match_date} "
        f"in competition {competition_id} season {season_id}"
    )


def load_match(
    statsbomb_data: Path,
    match_id: int,
    *,
    allow_fetch: bool = True,
) -> MatchData:
    """Load lineups, events, three-sixty for a given match_id."""
    base = statsbomb_data / "data"
    # Find the match meta record from competitions/matches.
    matches_dir = base / "matches"
    meta: dict[str, Any] | None = None
    if matches_dir.exists():
        for season_file in matches_dir.rglob("*.json"):
            try:
                with season_file.open("r", encoding="utf-8") as fh:
                    season = json.load(fh)
            except json.JSONDecodeError:
                continue
            for m in season:
                if int(m.get("match_id", 0)) == match_id:
                    meta = m
                    break
            if meta is not None:
                break
    if meta is None:
        # Fall back to the WC22 season file (we know match_id 3869685 is in 43/106).
        season_path = base / "matches" / str(DEFAULT_COMPETITION_ID) / f"{DEFAULT_SEASON_ID}.json"
        season = _read_or_fetch(
            season_path,
            f"/data/matches/{DEFAULT_COMPETITION_ID}/{DEFAULT_SEASON_ID}.json",
            allow_fetch=allow_fetch,
        )
        for m in season:
            if int(m.get("match_id", 0)) == match_id:
                meta = m
                break
    if meta is None:
        raise LookupError(f"could not locate metadata for match_id={match_id}")

    lineups = _read_or_fetch(
        base / "lineups" / f"{match_id}.json",
        f"/data/lineups/{match_id}.json",
        allow_fetch=allow_fetch,
    )
    events = _read_or_fetch(
        base / "events" / f"{match_id}.json",
        f"/data/events/{match_id}.json",
        allow_fetch=allow_fetch,
    )
    try:
        three_sixty = _read_or_fetch(
            base / "three-sixty" / f"{match_id}.json",
            f"/data/three-sixty/{match_id}.json",
            allow_fetch=allow_fetch,
        )
    except (FileNotFoundError, OSError):
        log.warning("no three-sixty data for match %s; state synthesis will be sparse", match_id)
        three_sixty = []

    return MatchData(
        match_id=match_id,
        match_meta=meta,
        lineups=lineups,
        events=events,
        three_sixty=three_sixty,
    )
