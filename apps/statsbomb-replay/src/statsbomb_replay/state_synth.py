"""State-frame synthesis from StatsBomb event + 360 freeze-frame data.

StatsBomb gives discrete events, not continuous tracking. To produce a
spec-conformant 10Hz state stream we treat the 360 freeze-frames (and
shot freeze-frames embedded in Shot events) as positional anchors and
linearly interpolate per player between consecutive anchors.

Identity inference: 360 freeze-frame entries do *not* carry player IDs;
we assign them by Hungarian (linear-sum) matching against the previous
resolved frame, with formation positions used as the seed at the start
of each period.

Limitations (parked in IDEAS.md):
- We only have anchors for the ~3,683 events with 360 data; the gaps
  between anchors are filled by linear interpolation per player which
  produces visually plausible but not realistic motion.
- We do not currently propagate player roles across shifts of position;
  a tactical-shift event resets the formation seed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment  # type: ignore[import-untyped]

from .coords import absolute_sb_to_spec_xy, sb_to_spec_xy
from .mapping import (
    AWAY_TEAM_SB_ID,
    HOME_TEAM_SB_ID,
    parse_timestamp_ms,
    player_id,
)

log = logging.getLogger(__name__)

STATE_HZ = 10
STATE_DT_MS = 1000 // STATE_HZ


@dataclass
class Anchor:
    """A positional anchor extracted from a StatsBomb event."""

    t_ms: int
    period: int
    # Map of spec player_id -> (x, y) in spec coordinates.
    player_pos: dict[str, tuple[float, float]] = field(default_factory=dict)
    # Ball position (x, y, z) in spec coords; None if unknown.
    ball_pos: tuple[float, float, float] | None = None
    # Carrier player_id, if any.
    carrier: str | None = None


def _home_attacks_left_to_right(period: int) -> bool:
    """In StatsBomb 360 frames the home team attacks left-to-right in
    period 1 (and again in ET2 / period 4 by convention) and right-to-
    left in period 2 / ET1 / period 3 / pens / period 5.

    Spec convention is fixed (home always attacks +x). So when the home
    team is attacking left-to-right in StatsBomb that aligns with spec +x
    and we don't flip; otherwise we flip.
    """
    return period in {1, 4, 5}


def _formation_seed(
    starting_lineup: dict[int, list[dict[str, Any]]],
) -> dict[str, tuple[float, float]]:
    """Build a rough-and-ready spec-coord seed from each team's formation.

    ``starting_lineup`` is keyed by StatsBomb team_id and each value is
    a list of ``{"player": {"id": ...}, "position": {"name": ...}, ...}``
    dicts taken from a Starting XI tactics block. We map each named
    position (e.g. "Right Back") to a canonical pitch slot and then
    transform to spec coords assuming the home team attacks +x.
    """
    # Canonical slots in StatsBomb 120x80 coords for an attacking-+x team.
    slots = {
        "Goalkeeper": (8, 40),
        "Right Back": (30, 65),
        "Left Back": (30, 15),
        "Right Center Back": (25, 50),
        "Left Center Back": (25, 30),
        "Center Back": (25, 40),
        "Right Wing Back": (45, 70),
        "Left Wing Back": (45, 10),
        "Right Defensive Midfield": (45, 50),
        "Left Defensive Midfield": (45, 30),
        "Center Defensive Midfield": (45, 40),
        "Right Center Midfield": (60, 50),
        "Left Center Midfield": (60, 30),
        "Center Midfield": (60, 40),
        "Right Midfield": (60, 60),
        "Left Midfield": (60, 20),
        "Right Attacking Midfield": (75, 50),
        "Left Attacking Midfield": (75, 30),
        "Center Attacking Midfield": (75, 40),
        "Right Wing": (85, 60),
        "Left Wing": (85, 20),
        "Right Center Forward": (90, 50),
        "Left Center Forward": (90, 30),
        "Center Forward": (95, 40),
        "Secondary Striker": (90, 40),
    }
    seed: dict[str, tuple[float, float]] = {}
    for team_id, lineup in starting_lineup.items():
        is_home = team_id == HOME_TEAM_SB_ID
        for entry in lineup:
            pid = (entry.get("player") or {}).get("id")
            pos = (entry.get("position") or {}).get("name", "Center Midfield")
            if pid is None:
                continue
            slot = slots.get(pos, (60, 40))
            spec_xy = sb_to_spec_xy(slot, possessing_team_is_home=is_home)
            seed[player_id(pid)] = spec_xy
    return seed


def _hungarian_assign(
    candidate_xy: list[tuple[float, float]],
    candidate_team_is_home: list[bool],
    candidate_is_keeper: list[bool],
    prev_pos: dict[str, tuple[float, float]],
    home_player_ids: set[str],
    away_player_ids: set[str],
    home_keeper_id: str | None,
    away_keeper_id: str | None,
) -> dict[str, tuple[float, float]]:
    """Assign anonymous freeze-frame entries to known player IDs.

    We split into per-team sub-problems (a freeze-frame entry's
    ``teammate`` flag and the team currently in possession tell us which
    side it belongs to). For each side we run a Hungarian assignment
    matching candidate positions to the previous-frame positions of that
    side's players.

    Keepers are assigned first if a keeper flag is set, since GKs are the
    most stable identity in any frame.
    """
    assignments: dict[str, tuple[float, float]] = {}

    for is_home, side_ids, keeper_id in (
        (True, home_player_ids, home_keeper_id),
        (False, away_player_ids, away_keeper_id),
    ):
        side_candidates = [
            (i, xy)
            for i, (xy, is_h) in enumerate(
                zip(candidate_xy, candidate_team_is_home, strict=False)
            )
            if is_h is is_home
        ]
        # Pull keeper candidate(s) out first.
        if keeper_id is not None:
            keeper_idx_choices = [
                (i, xy)
                for (i, xy) in side_candidates
                if candidate_is_keeper[i]
            ]
            if keeper_idx_choices:
                # Use the closest one to keeper's previous pos if known.
                prev_kpos = prev_pos.get(keeper_id)
                if prev_kpos is None:
                    chosen = keeper_idx_choices[0]
                else:
                    chosen = min(
                        keeper_idx_choices,
                        key=lambda pair: (pair[1][0] - prev_kpos[0]) ** 2
                        + (pair[1][1] - prev_kpos[1]) ** 2,
                    )
                assignments[keeper_id] = chosen[1]
                side_candidates = [pair for pair in side_candidates if pair[0] != chosen[0]]
        # Hungarian on the remainder.
        # Build candidate positions and previous positions for outfielders.
        outfield_ids = [pid for pid in side_ids if pid != keeper_id]
        # Drop already-assigned IDs (e.g. if keeper was assigned).
        outfield_ids = [pid for pid in outfield_ids if pid not in assignments]
        if not outfield_ids or not side_candidates:
            continue
        prev_xy = [prev_pos.get(pid, (0.0, 0.0)) for pid in outfield_ids]
        cand_xy_only = [xy for (_i, xy) in side_candidates]
        rows = len(prev_xy)
        cols = len(cand_xy_only)
        # Pad to square matrix with high-cost dummies so unmatched players
        # / candidates simply hold their previous position / are dropped.
        n = max(rows, cols)
        cost = np.full((n, n), 1e6, dtype=np.float64)
        for i in range(rows):
            for j in range(cols):
                dx = prev_xy[i][0] - cand_xy_only[j][0]
                dy = prev_xy[i][1] - cand_xy_only[j][1]
                cost[i, j] = dx * dx + dy * dy
        row_ind, col_ind = linear_sum_assignment(cost)
        for ri, ci in zip(row_ind, col_ind, strict=False):
            if ri < rows and ci < cols:
                assignments[outfield_ids[ri]] = cand_xy_only[ci]
            elif ri < rows:
                # No candidate for this player — hold previous pos.
                assignments[outfield_ids[ri]] = prev_xy[ri]

    return assignments


def collect_starting_lineups(events: list[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    """Return ``{team_id: [tactic_entry, ...]}`` from the two ``Starting XI`` events."""
    out: dict[int, list[dict[str, Any]]] = {}
    for ev in events:
        if (ev.get("type") or {}).get("name") == "Starting XI":
            tid = (ev.get("team") or {}).get("id")
            if tid is not None:
                out[tid] = (ev.get("tactics") or {}).get("lineup", [])
    return out


def collect_keeper_ids(starting: dict[int, list[dict[str, Any]]]) -> dict[int, str]:
    """Return ``{team_id: spec_player_id}`` for each side's starting goalkeeper."""
    out: dict[int, str] = {}
    for tid, lineup in starting.items():
        for entry in lineup:
            pos_name = (entry.get("position") or {}).get("name", "")
            if "Goalkeeper" in pos_name:
                pid = (entry.get("player") or {}).get("id")
                if pid is not None:
                    out[tid] = player_id(pid)
                break
    return out


def collect_team_player_ids(starting: dict[int, list[dict[str, Any]]]) -> dict[int, set[str]]:
    """Return ``{team_id: {spec_player_id, ...}}`` for the starting XI of each side."""
    out: dict[int, set[str]] = {}
    for tid, lineup in starting.items():
        ids: set[str] = set()
        for entry in lineup:
            pid = (entry.get("player") or {}).get("id")
            if pid is not None:
                ids.add(player_id(pid))
        out[tid] = ids
    return out


def event_t_ms(ev: dict[str, Any]) -> int:
    """Compute spec ``t`` for a StatsBomb event using its match-cumulative
    ``minute`` / ``second`` fields. See ``mapping.TimingContext.event_t``
    for the rationale (StatsBomb minutes count from match start across
    all periods including penalties, so we don't need a per-period base).
    """
    minute = int(ev.get("minute", 0))
    second = int(ev.get("second", 0))
    ms = parse_timestamp_ms(ev.get("timestamp", "00:00:00.000")) % 1000
    return minute * 60_000 + second * 1000 + ms


def build_anchors(
    events: list[dict[str, Any]],
    three_sixty: list[dict[str, Any]],
    starting: dict[int, list[dict[str, Any]]],
) -> list[Anchor]:
    """Build a chronologically-ordered list of state-anchor frames.

    Each StatsBomb event with positional info contributes one anchor:

    - 360 freeze-frame: gives all visible players' anonymous positions.
    - Shot event's embedded ``shot.freeze_frame``: gives all visible
      players' positions WITH player IDs (best fidelity).
    - Pass / Carry / Shot start with ``location``: gives just the
      actor's position; we layer this on top of the previous frame.
    """
    three_sixty_by_uuid = {entry["event_uuid"]: entry for entry in three_sixty}

    anchors: list[Anchor] = []
    home_ids = set()
    away_ids = set()
    for tid, players in collect_team_player_ids(starting).items():
        if tid == HOME_TEAM_SB_ID:
            home_ids = players
        elif tid == AWAY_TEAM_SB_ID:
            away_ids = players
    keeper_ids = collect_keeper_ids(starting)
    home_keeper = keeper_ids.get(HOME_TEAM_SB_ID)
    away_keeper = keeper_ids.get(AWAY_TEAM_SB_ID)

    # Seed with the formation centroid as t=0.
    seed = _formation_seed(starting)
    anchors.append(Anchor(t_ms=0, period=1, player_pos=dict(seed)))

    prev_pos = dict(seed)
    active_player_ids = home_ids | away_ids

    # Track substitutions so we know which IDs are live at each anchor.
    for ev in events:
        typ = (ev.get("type") or {}).get("name", "")
        if typ == "Substitution":
            sub = ev.get("substitution") or {}
            in_pid = (sub.get("replacement") or {}).get("id")
            out_pid = (ev.get("player") or {}).get("id")
            tid = (ev.get("team") or {}).get("id")
            if in_pid is not None and out_pid is not None:
                in_spec = player_id(in_pid)
                out_spec = player_id(out_pid)
                if tid == HOME_TEAM_SB_ID:
                    home_ids.discard(out_spec)
                    home_ids.add(in_spec)
                elif tid == AWAY_TEAM_SB_ID:
                    away_ids.discard(out_spec)
                    away_ids.add(in_spec)
                active_player_ids = home_ids | away_ids
                # New sub: seed at substituted player's last known pos.
                if out_spec in prev_pos:
                    prev_pos[in_spec] = prev_pos[out_spec]

        period = int(ev.get("period", 1))
        t_ms = event_t_ms(ev)

        # Build a per-event update of the prev_pos.
        new_pos = dict(prev_pos)

        # 1) Highest-fidelity: shot freeze-frame (player IDs included).
        sh_ff = (ev.get("shot") or {}).get("freeze_frame") or []
        if sh_ff:
            possessing_home = (ev.get("possession_team") or {}).get("id") == HOME_TEAM_SB_ID
            for entry in sh_ff:
                pid_sb = (entry.get("player") or {}).get("id")
                loc = entry.get("location")
                if pid_sb is None or loc is None:
                    continue
                xy = sb_to_spec_xy(loc[:2], possessing_team_is_home=possessing_home)
                new_pos[player_id(pid_sb)] = xy
            # The shooter location.
            shooter_loc = ev.get("location")
            shooter_pid = (ev.get("player") or {}).get("id")
            if shooter_loc and shooter_pid is not None:
                xy = sb_to_spec_xy(
                    shooter_loc[:2],
                    possessing_team_is_home=possessing_home,
                )
                new_pos[player_id(shooter_pid)] = xy

        # 2) StatsBomb 360 freeze-frame anonymous fill (Hungarian-assigned).
        ff = three_sixty_by_uuid.get(ev.get("id"))
        if ff is not None and ff.get("freeze_frame"):
            cand_xy = []
            cand_is_home = []
            cand_is_keeper = []
            possessing_home = (ev.get("possession_team") or {}).get("id") == HOME_TEAM_SB_ID
            home_attacks_lr = _home_attacks_left_to_right(period)
            for entry in ff["freeze_frame"]:
                loc = entry.get("location")
                if not loc:
                    continue
                # 360 frames are in match-orientation, not possession.
                xy = absolute_sb_to_spec_xy(loc[:2], home_attacks_left_to_right=home_attacks_lr)
                cand_xy.append(xy)
                # `teammate` is relative to the possessing team.
                is_teammate = bool(entry.get("teammate"))
                if possessing_home:
                    cand_is_home.append(is_teammate)
                else:
                    cand_is_home.append(not is_teammate)
                cand_is_keeper.append(bool(entry.get("keeper")))
            if cand_xy:
                assigned = _hungarian_assign(
                    cand_xy,
                    cand_is_home,
                    cand_is_keeper,
                    prev_pos=new_pos,
                    home_player_ids=home_ids,
                    away_player_ids=away_ids,
                    home_keeper_id=home_keeper,
                    away_keeper_id=away_keeper,
                )
                new_pos.update(assigned)

        # 3) Actor location (from the event's `location`) — overrides
        #    the inferred position with the canonical actor pos.
        if ev.get("location") and (ev.get("player") or {}).get("id") is not None:
            possessing_home = (ev.get("possession_team") or {}).get("id") == HOME_TEAM_SB_ID
            xy = sb_to_spec_xy(
                ev["location"][:2],
                possessing_team_is_home=possessing_home,
            )
            new_pos[player_id(ev["player"]["id"])] = xy

        # 4) Ball position: set to actor location for events that touch
        #    the ball; passes/shots set `vel` toward end_location.
        ball_pos: tuple[float, float, float] | None = None
        carrier: str | None = None
        if ev.get("location"):
            possessing_home = (ev.get("possession_team") or {}).get("id") == HOME_TEAM_SB_ID
            xy = sb_to_spec_xy(
                ev["location"][:2],
                possessing_team_is_home=possessing_home,
            )
            ball_pos = (xy[0], xy[1], 0.0)
            if (ev.get("player") or {}).get("id") is not None and typ in {
                "Pass",
                "Carry",
                "Ball Recovery",
                "Dribble",
                "Ball Receipt*",
            }:
                carrier = player_id(ev["player"]["id"])

        anchors.append(
            Anchor(
                t_ms=t_ms,
                period=period,
                player_pos={pid: new_pos[pid] for pid in active_player_ids if pid in new_pos},
                ball_pos=ball_pos,
                carrier=carrier,
            )
        )
        prev_pos = new_pos

    anchors.sort(key=lambda a: a.t_ms)
    return anchors


def interpolate_state_frames(
    anchors: list[Anchor],
    *,
    state_dt_ms: int = STATE_DT_MS,
    max_gap_ms: int = 5000,
) -> list[dict[str, Any]]:
    """Convert a sequence of anchors into 10Hz state frames.

    Linear interpolation between consecutive anchors per player. If a
    player is missing from an anchor we hold their last-known position.
    Gaps longer than ``max_gap_ms`` produce held positions only (no
    extrapolation).
    """
    if not anchors:
        return []

    frames: list[dict[str, Any]] = []
    last_known: dict[str, tuple[float, float]] = {}

    for i in range(len(anchors) - 1):
        a = anchors[i]
        b = anchors[i + 1]
        last_known.update(a.player_pos)
        if b.t_ms <= a.t_ms:
            continue
        gap = b.t_ms - a.t_ms
        # Step in `state_dt_ms` increments; do not duplicate anchor B itself.
        n_steps = max(1, gap // state_dt_ms)
        clamp_lerp = gap > max_gap_ms
        for k in range(n_steps):
            t = a.t_ms + k * state_dt_ms
            alpha = (t - a.t_ms) / max(1, gap)
            if clamp_lerp:
                alpha = 0.0  # hold position for huge gaps
            players_state: list[dict[str, Any]] = []
            for pid, end_xy in b.player_pos.items():
                start_xy = a.player_pos.get(pid, last_known.get(pid, end_xy))
                x = start_xy[0] + (end_xy[0] - start_xy[0]) * alpha
                y = start_xy[1] + (end_xy[1] - start_xy[1]) * alpha
                # Velocity-based facing: heading toward end position.
                dx = end_xy[0] - start_xy[0]
                dy = end_xy[1] - start_xy[1]
                facing = float(np.arctan2(dy, dx)) if (dx or dy) else 0.0
                speed = float(np.hypot(dx, dy)) / max(1, gap) * 1000.0  # m/s
                anim = "idle"
                if speed > 6.0:
                    anim = "sprint"
                elif speed > 4.0:
                    anim = "run"
                elif speed > 1.5:
                    anim = "walk"
                players_state.append(
                    {
                        "id": pid,
                        "pos": [round(x, 3), round(y, 3)],
                        "facing": round(facing, 3),
                        "anim": anim,
                    }
                )
            ball = a.ball_pos or (0.0, 0.0, 0.0)
            frame: dict[str, Any] = {
                "type": "state",
                "t": t,
                "ball": {
                    "pos": [round(ball[0], 3), round(ball[1], 3), round(ball[2], 3)],
                },
                "players": players_state,
                "period": a.period,
                "clock_display": _clock_display(t),
            }
            if a.carrier:
                frame["ball"]["carrier"] = a.carrier
            frames.append(frame)

    # Final anchor frame.
    final = anchors[-1]
    if frames and frames[-1]["t"] >= final.t_ms:
        return frames
    final_state = []
    for pid, xy in final.player_pos.items():
        final_state.append(
            {
                "id": pid,
                "pos": [round(xy[0], 3), round(xy[1], 3)],
                "facing": 0.0,
                "anim": "idle",
            }
        )
    final_ball = final.ball_pos or (0.0, 0.0, 0.0)
    frames.append(
        {
            "type": "state",
            "t": final.t_ms,
            "ball": {
                "pos": [
                    round(final_ball[0], 3),
                    round(final_ball[1], 3),
                    round(final_ball[2], 3),
                ],
            },
            "players": final_state,
            "period": final.period,
            "clock_display": _clock_display(final.t_ms),
        }
    )
    return frames


def _clock_display(t_ms: int) -> str:
    """Render a HUD-style mm:ss clock from match-clock ms."""
    s = max(0, t_ms // 1000)
    return f"{s // 60:02d}:{s % 60:02d}"
