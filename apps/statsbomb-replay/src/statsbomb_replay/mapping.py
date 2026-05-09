"""Map StatsBomb structures to VTorn spec messages.

This module is pure: every public function takes raw StatsBomb dicts and
returns dicts shaped per ``packages/spec/src/index.ts`` (SPEC_VERSION
0.1.1). No I/O, no async — easy to unit-test.

Conventions used here:

- Spec player IDs are ``"P_<statsbomb_id>"``.
- Spec team IDs are short codes: ``"ARG"``, ``"FRA"``. We hard-code the
  AR-FR final's two teams since this producer is scoped to that match;
  for future multi-match support we'd derive them from the StatsBomb
  ``team`` records.
- ``t`` for every emitted message is integer milliseconds since
  ``match.init``. We map StatsBomb ``period`` + ``minute`` + ``second`` +
  millis-of-timestamp to a continuous match-clock millisecond count
  (period 1 starts at 0; period 2 at 45*60*1000; period 3/ET at
  90*60*1000; period 4 at 105*60*1000; period 5/pens after period 4
  ends).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .coords import sb_to_spec_xy, sb_to_spec_xyz
from .photos import PlayerPhoto

# Team identity for the AR-FR final.
HOME_TEAM_SB_ID = 779
HOME_TEAM_NAME = "Argentina"
HOME_TEAM_SHORT = "ARG"
AWAY_TEAM_SB_ID = 771
AWAY_TEAM_NAME = "France"
AWAY_TEAM_SHORT = "FRA"

# Kit colours: Argentina home (light blue + white), France home
# (dark blue + white). Goalkeepers wear distinctive kits per StatsBomb
# era (Martinez green, Lloris yellow).
KIT_ARG = {
    "primary": "#75AADB",
    "secondary": "#FFFFFF",
    "text": "#000000",
    "goalkeeper": {"primary": "#1F7A1F", "secondary": "#000000", "text": "#FFFFFF"},
}
KIT_FRA = {
    "primary": "#1A2B5C",
    "secondary": "#FFFFFF",
    "text": "#FFFFFF",
    "goalkeeper": {"primary": "#F5C518", "secondary": "#000000", "text": "#000000"},
}

# Period start offsets (ms since match.init).
# Match begins at 0, half-time at 45'00, ET starts after 90'00, ET2 after
# 105'00, penalty shoot-out after 120'00.
PERIOD_BASE_MS = {
    1: 0,
    2: 45 * 60_000,
    3: 90 * 60_000,
    4: 105 * 60_000,
    5: 120 * 60_000,
}


def player_id(sb_player_id: int | str) -> str:
    return f"P_{sb_player_id}"


def team_short(sb_team_id: int) -> str:
    if sb_team_id == HOME_TEAM_SB_ID:
        return HOME_TEAM_SHORT
    if sb_team_id == AWAY_TEAM_SB_ID:
        return AWAY_TEAM_SHORT
    return f"T_{sb_team_id}"


@dataclass
class TimingContext:
    """Tracks per-period clock to produce strictly increasing ``t`` values."""

    last_t_ms: int = -1

    def event_t(self, period: int, minute: int, second: int, ms: int = 0) -> int:
        """Convert a StatsBomb timestamp to spec ``t`` ms.

        StatsBomb's ``minute``/``second`` fields cumulate from the start
        of the match for *all* periods including penalties — e.g. the
        first penalty shoot-out event has ``minute=120, second=0`` even
        though the period-relative ``timestamp`` field restarts at zero.

        So we compute ``t`` directly from minute/second/ms regardless of
        period; ``PERIOD_BASE_MS`` is exposed only for callers that derive
        ``t`` from a relative timestamp (see ``state_synth.event_t_ms``).
        """
        del period  # unused; kept in the signature for caller clarity
        t = minute * 60_000 + second * 1000 + ms
        # Guarantee monotonicity within each emit pass.
        if t <= self.last_t_ms:
            t = self.last_t_ms + 1
        self.last_t_ms = t
        return t


def parse_timestamp_ms(ts: str) -> int:
    """Parse a StatsBomb timestamp ``"HH:MM:SS.mmm"`` into milliseconds."""
    if not ts:
        return 0
    h, m, s = ts.split(":")
    sec_full = float(s)
    return int((int(h) * 3600 + int(m) * 60 + sec_full) * 1000)


def build_match_init(
    *,
    match_id_slug: str,
    match_meta: dict[str, Any],
    lineups: list[dict[str, Any]],
    photos: dict[int, PlayerPhoto],
    producer: str = "statsbomb-replay-v0.1",
) -> dict[str, Any]:
    """Build a spec MatchInit from StatsBomb lineup + match metadata."""
    teams: list[dict[str, Any]] = []
    # StatsBomb lineups are an array of two team blobs; ensure ARG first
    # (team[0] in spec, defends -x).
    sorted_lineups = sorted(
        lineups,
        key=lambda lu: 0 if lu.get("team_id") == HOME_TEAM_SB_ID else 1,
    )
    for lu in sorted_lineups:
        team_id = lu.get("team_id")
        is_home = team_id == HOME_TEAM_SB_ID
        team_short_code = HOME_TEAM_SHORT if is_home else AWAY_TEAM_SHORT
        team_name = HOME_TEAM_NAME if is_home else AWAY_TEAM_NAME
        kit = KIT_ARG if is_home else KIT_FRA
        players = []
        for p in lu.get("lineup", []):
            sb_pid = p.get("player_id")
            if sb_pid is None:
                continue
            number = int(p.get("jersey_number", 0) or 0)
            positions = p.get("positions", [])
            position_name = positions[0]["position"] if positions else "Sub"
            start_reason = positions[0]["start_reason"] if positions else ""
            face_uri = ""
            if sb_pid in photos:
                face_uri = photos[sb_pid].image_url
            player = {
                "id": player_id(sb_pid),
                "name": p.get("player_name", ""),
                "number": number,
                "position": _short_position(position_name),
                "meta": {
                    "country": p.get("country", {}).get("name", ""),
                    "starting": "true" if start_reason == "Starting XI" else "false",
                    "sb_player_id": str(sb_pid),
                },
            }
            if face_uri:
                player["face_uri"] = face_uri
            players.append(player)
        teams.append(
            {
                "id": team_short_code,
                "name": team_name,
                "short_name": team_short_code,
                "kit": kit,
                "players": players,
            }
        )

    venue = match_meta.get("stadium", {}).get("name", "Lusail Iconic Stadium")
    competition = "FIFA World Cup 2022 — Final"

    return {
        "type": "match.init",
        "spec_version": "0.1.1",
        "match_id": match_id_slug,
        "sport": "soccer",
        "field": {"length": 105.0, "width": 68.0, "units": "m", "surface": "grass"},
        "teams": teams,  # exactly 2 entries; spec accepts as tuple
        "start_time": "2022-12-18T15:00:00Z",
        "venue": venue,
        "competition": competition,
        "producer": producer,
    }


def _short_position(name: str) -> str:
    """Compress a StatsBomb position name into a short tag for HUD use."""
    t = name.lower()
    if "goalkeeper" in t:
        return "GK"
    if "back" in t:
        if "right" in t:
            return "RB" if "wing" not in t else "RWB"
        if "left" in t:
            return "LB" if "wing" not in t else "LWB"
        return "CB"
    if "defensive midfield" in t:
        return "CDM"
    if "attacking midfield" in t:
        return "CAM"
    if "midfield" in t:
        if "right" in t:
            return "RM"
        if "left" in t:
            return "LM"
        return "CM"
    if "wing" in t:
        return "RW" if "right" in t else "LW"
    if "forward" in t or "striker" in t:
        return "ST"
    return name[:3].upper() if name else "SUB"


# ---------------------------------------------------------------------------
# Event mapping
# ---------------------------------------------------------------------------


def _is_home_team(sb_event: dict[str, Any]) -> bool:
    """True if the *possessing* team for this event is the home team."""
    pt = sb_event.get("possession_team") or sb_event.get("team") or {}
    return pt.get("id") == HOME_TEAM_SB_ID


def map_event(
    sb_event: dict[str, Any],
    timing: TimingContext,
) -> list[dict[str, Any]]:
    """Map a single StatsBomb event to zero, one, or many spec events.

    Returns a list because a goal generates both ``event.goal`` and
    ``event.score_change``, and a penalty shoot-out attempt may emit
    a ``event.penalty_attempt`` plus a ``event.save``.
    """
    period = int(sb_event.get("period", 1))
    minute = int(sb_event.get("minute", 0))
    second = int(sb_event.get("second", 0))
    ms_off = parse_timestamp_ms(sb_event.get("timestamp", "00:00:00.000"))
    millis = ms_off % 1000
    t = timing.event_t(period, minute, second, millis)
    typ = (sb_event.get("type") or {}).get("name", "")

    # Penalty shoot-out is a special period (5) — handled separately.
    if period == 5:
        return _map_penalty_period_event(sb_event, t, typ)

    if typ == "Half Start":
        return [{"type": "event.period_start", "t": t, "period": period}]
    if typ == "Half End":
        return [{"type": "event.period_end", "t": t, "period": period}]

    if typ == "Pass":
        return _map_pass(sb_event, t)
    if typ == "Shot":
        return _map_shot(sb_event, t)
    if typ == "Foul Committed":
        return _map_foul(sb_event, t)
    if typ == "Goal Keeper":
        return _map_goalkeeper(sb_event, t)
    if typ == "Substitution":
        return _map_substitution(sb_event, t)

    # Other StatsBomb event types (Carry, Pressure, Ball Receipt) we
    # consume internally for state synthesis but don't emit. Returning
    # an empty list signals "ignore this event for the spec stream".
    return []


def _map_pass(sb_event: dict[str, Any], t: int) -> list[dict[str, Any]]:
    p = sb_event.get("pass") or {}
    is_home = _is_home_team(sb_event)
    end_loc = p.get("end_location") or [60.0, 40.0]
    target_xy = sb_to_spec_xy(end_loc[:2], possessing_team_is_home=is_home)
    from_pid = (sb_event.get("player") or {}).get("id")
    recipient = (p.get("recipient") or {}).get("id")
    success = p.get("outcome") is None  # outcome is set when the pass fails
    msg: dict[str, Any] = {
        "type": "event.pass",
        "t": t,
        "from": player_id(from_pid) if from_pid is not None else "",
        "target": [round(target_xy[0], 3), round(target_xy[1], 3)],
        "success": bool(success),
    }
    if recipient is not None:
        msg["to"] = player_id(recipient)
    return [msg]


def _map_shot(sb_event: dict[str, Any], t: int) -> list[dict[str, Any]]:
    sh = sb_event.get("shot") or {}
    is_home = _is_home_team(sb_event)
    end_loc = sh.get("end_location") or [120.0, 40.0, 0.0]
    target_xyz = sb_to_spec_xyz(list(end_loc), possessing_team_is_home=is_home)
    outcome = (sh.get("outcome") or {}).get("name", "")
    on_target = outcome in {"Goal", "Saved", "Saved To Post", "Saved Off Target"}
    saved = outcome in {"Saved", "Saved To Post", "Saved Off Target"}
    pid = (sb_event.get("player") or {}).get("id")
    out: list[dict[str, Any]] = [
        {
            "type": "event.shot",
            "t": t,
            "player": player_id(pid) if pid is not None else "",
            "target": [round(target_xyz[0], 3), round(target_xyz[1], 3), round(target_xyz[2], 3)],
            "on_target": bool(on_target),
            "saved": bool(saved),
        }
    ]
    if outcome == "Goal":
        team_sb_id = (sb_event.get("team") or {}).get("id", 0)
        out.append(
            {
                "type": "event.goal",
                "t": t + 1,
                "player": player_id(pid) if pid is not None else "",
                "team": team_short(team_sb_id),
            }
        )
    return out


def _map_foul(sb_event: dict[str, Any], t: int) -> list[dict[str, Any]]:
    fc = sb_event.get("foul_committed") or {}
    pid = (sb_event.get("player") or {}).get("id")
    severity: str = "soft"
    card = (fc.get("card") or {}).get("name", "")
    if "Red" in card:
        severity = "red"
    elif "Yellow" in card:
        severity = "yellow"
    return [
        {
            "type": "event.foul",
            "t": t,
            "player": player_id(pid) if pid is not None else "",
            "severity": severity,
        }
    ]


def _map_goalkeeper(sb_event: dict[str, Any], t: int) -> list[dict[str, Any]]:
    gk = sb_event.get("goalkeeper") or {}
    gk_type = (gk.get("type") or {}).get("name", "")
    pid = (sb_event.get("player") or {}).get("id")
    save_types = {"Shot Saved", "Shot Saved To Post", "Shot Saved Off Target", "Penalty Saved"}
    if gk_type in save_types and pid is not None:
        return [{"type": "event.save", "t": t, "keeper": player_id(pid)}]
    return []


def _map_substitution(sb_event: dict[str, Any], t: int) -> list[dict[str, Any]]:
    sub = sb_event.get("substitution") or {}
    out_pid = (sb_event.get("player") or {}).get("id")
    in_pid = (sub.get("replacement") or {}).get("id")
    team_sb_id = (sb_event.get("team") or {}).get("id", 0)
    if in_pid is None or out_pid is None:
        return []
    return [
        {
            "type": "event.substitution",
            "t": t,
            "team": team_short(team_sb_id),
            "player_in": player_id(in_pid),
            "player_out": player_id(out_pid),
        }
    ]


def _map_penalty_period_event(
    sb_event: dict[str, Any],
    t: int,
    typ: str,
) -> list[dict[str, Any]]:
    """Handle the penalty shoot-out (StatsBomb period 5) events.

    The shoot-out is bracketed by two ``Half Start`` events (one per team)
    at the start and two ``Half End`` events at the end. We emit
    ``event.penalty_shootout_start`` once on the first Half Start and
    ``event.penalty_shootout_end`` once on the first Half End; the second
    pair is suppressed (kept inside the timing context's
    ``shootout_started`` / ``shootout_ended`` flags via class attributes
    on the dict approach below would be neater; here we use simple
    reasoning: emit start on Half Start with team == France because that
    is the first event in StatsBomb's order, end on Half End with team ==
    France).
    """
    # Each penalty event in period 5 is either a Shot (the kicker) or a
    # Goal Keeper event (post-shot). We emit one penalty_attempt per Shot
    # event, deriving the outcome from shot.outcome.
    if typ == "Shot":
        sh = sb_event.get("shot") or {}
        outcome = (sh.get("outcome") or {}).get("name", "")
        pid = (sb_event.get("player") or {}).get("id")
        team_sb_id = (sb_event.get("team") or {}).get("id", 0)
        if outcome == "Goal":
            spec_outcome = "scored"
        elif outcome in {"Saved", "Saved To Post", "Saved Off Target"}:
            spec_outcome = "saved"
        else:
            # "Off T" (off target), "Post", "Wayward" → missed.
            spec_outcome = "missed"
        end_loc = sh.get("end_location") or [120.0, 40.0, 1.5]
        is_home = _is_home_team(sb_event)
        target_xyz = sb_to_spec_xyz(list(end_loc), possessing_team_is_home=is_home)
        msg: dict[str, Any] = {
            "type": "event.penalty_attempt",
            "t": t,
            "player": player_id(pid) if pid is not None else "",
            "team": team_short(team_sb_id),
            "outcome": spec_outcome,
            "target": [
                round(target_xyz[0], 3),
                round(target_xyz[1], 3),
                round(target_xyz[2], 3),
            ],
        }
        return [msg]
    # Half Start / Half End / Goal Keeper / Bad Behaviour during pens —
    # we do NOT emit them as standalone spec events; the caller is
    # responsible for emitting penalty_shootout_start / _end at the right
    # time using a higher-level state machine (see emitter.py).
    return []
