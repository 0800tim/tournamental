"""Top-level stream builder.

Combines lineups + events + 360 freeze-frames into a single chronologically
ordered list of spec messages: ``match.init``, then state frames at 10Hz
interleaved with ``event.*`` messages, ending with ``event.match_end``.

Adds the bookkeeping the per-event mapper can't see in isolation:

- ``event.kickoff`` for the canonical match-start kickoff and after each
  goal.
- ``event.score_change`` after each ``event.goal``.
- Penalty shoot-out bracketing (``event.penalty_shootout_start`` /
  ``event.penalty_shootout_end``).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from . import DEFAULT_MATCH_SLUG, SPEC_VERSION
from .loader import MatchData
from .mapping import (
    AWAY_TEAM_SB_ID,
    HOME_TEAM_SB_ID,
    HOME_TEAM_SHORT,
    PERIOD_BASE_MS,
    TimingContext,
    build_match_init,
    map_event,
    parse_timestamp_ms,
    player_id,
    team_short,
)
from .photos import load_photos
from .state_synth import (
    build_anchors,
    collect_starting_lineups,
    interpolate_state_frames,
)

log = logging.getLogger(__name__)


@dataclass
class StreamStats:
    n_events: int = 0
    n_state_frames: int = 0
    home_score: int = 0
    away_score: int = 0
    pen_score_home: int = 0
    pen_score_away: int = 0


def build_messages(
    match: MatchData,
    *,
    match_slug: str = DEFAULT_MATCH_SLUG,
) -> tuple[list[dict[str, Any]], StreamStats]:
    """Produce the full ordered list of spec messages for one match.

    Returns ``(messages, stats)``.
    """
    photos = load_photos()
    init_msg = build_match_init(
        match_id_slug=match_slug,
        match_meta=match.match_meta,
        lineups=match.lineups,
        photos=photos,
    )
    init_msg["spec_version"] = SPEC_VERSION

    starting = collect_starting_lineups(match.events)
    anchors = build_anchors(match.events, match.three_sixty, starting)
    state_frames = interpolate_state_frames(anchors)

    timing = TimingContext()
    events: list[dict[str, Any]] = []

    # --- emit kickoff at t=0 (Argentina starts with the ball, but in
    # StatsBomb the first Pass is by France from kickoff — see event 5).
    # We pick the team of the first Pass with `pass.type.name == "Kick Off"`
    # as the canonical kickoff team.
    kickoff_team_id = HOME_TEAM_SB_ID
    for ev in match.events:
        p = ev.get("pass") or {}
        if (p.get("type") or {}).get("name") == "Kick Off":
            kickoff_team_id = (ev.get("team") or {}).get("id", HOME_TEAM_SB_ID)
            break
    events.append(
        {
            "type": "event.kickoff",
            "t": 0,
            "team": team_short(kickoff_team_id),
        }
    )

    stats = StreamStats()
    shootout_started = False
    shootout_pen_count = 0
    shootout_ended = False

    for sb_ev in match.events:
        period = int(sb_ev.get("period", 1))
        typ = (sb_ev.get("type") or {}).get("name", "")

        # Penalty period bracketing.
        if period == 5 and not shootout_started:
            t_ms = (
                int(sb_ev.get("minute", 0)) * 60_000
                + int(sb_ev.get("second", 0)) * 1000
            )
            events.append({"type": "event.penalty_shootout_start", "t": t_ms})
            shootout_started = True

        mapped = map_event(sb_ev, timing)

        # Score-change emission whenever a goal is mapped (regulation/ET only).
        for m in mapped:
            if m.get("type") == "event.goal":
                team = m.get("team")
                if team == HOME_TEAM_SHORT:
                    stats.home_score += 1
                else:
                    stats.away_score += 1
                events.append(m)
                events.append(
                    {
                        "type": "event.score_change",
                        "t": m["t"] + 1,
                        "home": stats.home_score,
                        "away": stats.away_score,
                    }
                )
                # Restart kickoff for the conceding team ~5s after the goal.
                conceding = (
                    team_short(AWAY_TEAM_SB_ID)
                    if team == HOME_TEAM_SHORT
                    else team_short(HOME_TEAM_SB_ID)
                )
                events.append(
                    {
                        "type": "event.kickoff",
                        "t": m["t"] + 5_000,
                        "team": conceding,
                    }
                )
            elif m.get("type") == "event.penalty_attempt":
                outcome = m.get("outcome")
                team = m.get("team")
                if outcome == "scored":
                    if team == HOME_TEAM_SHORT:
                        stats.pen_score_home += 1
                    else:
                        stats.pen_score_away += 1
                shootout_pen_count += 1
                events.append(m)
            else:
                events.append(m)

        # Detect Half End in period 4 → emit match_end before pens, or
        # period 2 if the match did not go to ET.
        if typ == "Half End" and period == 4:
            # Period 4 ends; full-time aggregate already emitted via Half
            # End event above. Match continues to penalty period 5 if
            # there is one.
            pass

    # Emit penalty_shootout_end and match_end at the timestamp of the
    # last period-5 event, or the last event overall.
    if shootout_started and not shootout_ended:
        # Find last shot in period 5.
        last_t = events[-1]["t"] if events else 0
        for m in reversed(events):
            if m.get("type") == "event.penalty_attempt":
                last_t = m["t"]
                break
        winner = (
            HOME_TEAM_SHORT
            if stats.pen_score_home > stats.pen_score_away
            else team_short(AWAY_TEAM_SB_ID)
        )
        events.append(
            {
                "type": "event.penalty_shootout_end",
                "t": last_t + 1000,
                "winner": winner,
                "score": {
                    "home": stats.pen_score_home,
                    "away": stats.pen_score_away,
                },
            }
        )
        shootout_ended = True

    last_t = max((m["t"] for m in events), default=0)
    state_t = max((f["t"] for f in state_frames), default=0)
    final_t = max(last_t, state_t) + 1000
    events.append({"type": "event.match_end", "t": final_t})

    # Merge state frames + events in time order. Events tie-break before
    # state frames at the same t so the renderer applies them first.
    merged: list[dict[str, Any]] = []
    ei = 0
    si = 0
    while ei < len(events) and si < len(state_frames):
        et = events[ei]["t"]
        st = state_frames[si]["t"]
        if et <= st:
            merged.append(events[ei])
            ei += 1
        else:
            merged.append(state_frames[si])
            si += 1
    merged.extend(events[ei:])
    merged.extend(state_frames[si:])

    stats.n_events = sum(1 for m in merged if m["type"].startswith("event."))
    stats.n_state_frames = sum(1 for m in merged if m["type"] == "state")

    return [init_msg, *merged], stats


def parse_timestamp_match_t(period: int, minute: int, second: int, ts: str) -> int:
    """Wrapper exposing the timing math for tests."""
    millis = parse_timestamp_ms(ts) % 1000
    if period == 5:
        return PERIOD_BASE_MS[5] + minute * 60_000 + second * 1000 + millis
    return minute * 60_000 + second * 1000 + millis


# Re-export for downstream convenience.
__all__ = [
    "StreamStats",
    "build_messages",
    "parse_timestamp_match_t",
    "player_id",
]
