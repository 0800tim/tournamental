"""Parsing-correctness tests: a fixed StatsBomb event JSON in, a fixed spec
message out. These pin the wire contract — if any of these break we know
the AR-FR demo will misrender."""
from __future__ import annotations

import json
from pathlib import Path

from statsbomb_replay.coords import sb_to_spec_xy
from statsbomb_replay.mapping import (
    TimingContext,
    map_event,
    parse_timestamp_ms,
    player_id,
    team_short,
)
from statsbomb_replay.photos import load_photos

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_parse_timestamp_ms():
    assert parse_timestamp_ms("00:00:00.000") == 0
    assert parse_timestamp_ms("00:00:00.578") == 578
    assert parse_timestamp_ms("00:01:23.500") == 83_500
    assert parse_timestamp_ms("01:00:00.000") == 3_600_000


def test_player_id_and_team_short():
    assert player_id(5503) == "P_5503"
    assert team_short(779) == "ARG"
    assert team_short(771) == "FRA"
    assert team_short(999) == "T_999"


def test_coords_home_no_flip():
    # Centre of pitch in StatsBomb (60, 40) should map to (0, 0) in spec.
    x, y = sb_to_spec_xy((60.0, 40.0), possessing_team_is_home=True)
    assert abs(x) < 1e-6
    assert abs(y) < 1e-6


def test_coords_away_flips_through_origin():
    # Away possession: (60, 40) still centre, (90, 40) flips x sign.
    x, y = sb_to_spec_xy((90.0, 40.0), possessing_team_is_home=False)
    # 90-60 = 30 in 120 units = 0.25 of pitch length 105m = 26.25m, then negated
    assert abs(x + 26.25) < 1e-3
    assert abs(y) < 1e-6


def test_pass_event_maps_to_spec_pass():
    sb = _load("sample_pass.json")
    timing = TimingContext()
    out = map_event(sb, timing)
    assert len(out) == 1
    msg = out[0]
    assert msg["type"] == "event.pass"
    assert msg["from"] == "P_5487"
    assert msg["to"] == "P_10481"
    assert msg["success"] is True
    assert msg["t"] == 578  # 00:00:00.578
    # End_location [48, 43.2] from a France-possession event so flipped.
    # SB units: x_c = 48-60 = -12 → -10.5 m, flipped to +10.5
    #           y_c = 43.2-40 = 3.2 → 2.72 m, flipped to -2.72
    assert abs(msg["target"][0] - 10.5) < 1e-2
    assert abs(msg["target"][1] + 2.72) < 1e-2


def test_shot_goal_emits_two_messages():
    sb = _load("sample_shot_goal.json")
    timing = TimingContext()
    out = map_event(sb, timing)
    types = [m["type"] for m in out]
    assert types == ["event.shot", "event.goal"]
    shot, goal = out
    assert shot["player"] == "P_2995"
    assert shot["on_target"] is True
    assert shot["saved"] is False
    assert goal["player"] == "P_2995"
    assert goal["team"] == "ARG"
    assert goal["t"] == shot["t"] + 1


def test_penalty_attempt_period_5():
    sb = _load("sample_penalty_attempt.json")
    timing = TimingContext()
    out = map_event(sb, timing)
    assert len(out) == 1
    pen = out[0]
    assert pen["type"] == "event.penalty_attempt"
    assert pen["player"] == "P_3009"
    assert pen["team"] == "FRA"
    assert pen["outcome"] == "scored"
    # Target should have z > 0 since it's into the goal frame.
    assert len(pen["target"]) == 3


def test_timing_context_is_monotonic():
    timing = TimingContext()
    a = timing.event_t(1, 0, 0, 0)
    b = timing.event_t(1, 0, 0, 0)  # same timestamp, must be > a
    c = timing.event_t(1, 0, 1, 0)
    assert b > a
    assert c > b


def test_period_5_minute_is_match_cumulative():
    """StatsBomb period-5 events carry minute=120+; we trust that
    cumulative value rather than reapplying a 120-min offset."""
    timing = TimingContext()
    # Mbappé pen: minute=120, second=13, ms=386
    t = timing.event_t(5, 120, 13, 386)
    assert t == 120 * 60_000 + 13 * 1000 + 386


def test_photos_csv_loads_22_starters():
    photos = load_photos()
    assert len(photos) == 22, "expected 22 starters in wc2022-final-players.csv"
    # Spot-check Messi.
    assert 5503 in photos
    assert photos[5503].number == 10
    assert photos[5503].country == "Argentina"
    assert photos[5503].image_url.startswith("https://commons.wikimedia.org/")
    # Spot-check Mbappé.
    assert 3009 in photos
    assert photos[3009].country == "France"
