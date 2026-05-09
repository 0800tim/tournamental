"""Integration smoke test against the real AR-FR final.

Skipped automatically when the StatsBomb open-data clone is not on the
test runner. CI runners can enable this by setting ``STATSBOMB_DATA`` to
a directory with the data under it.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from statsbomb_replay.emitter import build_messages
from statsbomb_replay.loader import load_match, resolve_match_id

DATA_PATH_ENV = "STATSBOMB_DATA"


@pytest.mark.skipif(
    DATA_PATH_ENV not in os.environ,
    reason="STATSBOMB_DATA env var not set; integration test skipped",
)
def test_arfr_final_streams_correctly():
    data_path = Path(os.environ[DATA_PATH_ENV])
    match_id = resolve_match_id(data_path, allow_fetch=False)
    match = load_match(data_path, match_id, allow_fetch=False)
    messages, stats = build_messages(match)

    # Sanity.
    assert messages[0]["type"] == "match.init"
    assert messages[0]["spec_version"] == "0.1.1"
    assert len(messages[0]["teams"]) == 2
    assert messages[0]["teams"][0]["id"] == "ARG"
    assert messages[0]["teams"][1]["id"] == "FRA"

    # End state.
    assert stats.home_score == 3
    assert stats.away_score == 3
    assert stats.pen_score_home == 4
    assert stats.pen_score_away == 2

    # Penalty bracketing.
    types = [m["type"] for m in messages]
    assert "event.penalty_shootout_start" in types
    pse = next(m for m in messages if m["type"] == "event.penalty_shootout_end")
    assert pse["winner"] == "ARG"
    assert pse["score"] == {"home": 4, "away": 2}

    # Final message must be event.match_end.
    assert messages[-1]["type"] == "event.match_end"

    # State frames cover regulation + ET + pens at 10Hz roughly. 150 min ~= 90,000
    # frames in theory, less because we only emit between anchors.
    assert stats.n_state_frames > 5_000
