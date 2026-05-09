"""Tests for the canonical fixture builder (deterministic, structural)."""

from __future__ import annotations

import pytest

from wc2026_data.canonical_fixtures import (
    GROUP_TEAMS_CLEAN,
    build_canonical_fixtures,
)


def test_total_match_count_is_104() -> None:
    fixtures = build_canonical_fixtures()
    assert len(fixtures) == 104


def test_match_numbers_are_dense_and_ordered() -> None:
    fixtures = build_canonical_fixtures()
    nums = [f.match_number for f in fixtures]
    assert nums == list(range(1, 105))


def test_group_stage_72_matches() -> None:
    fixtures = build_canonical_fixtures()
    group_matches = [f for f in fixtures if f.stage.startswith("group_")]
    assert len(group_matches) == 72


def test_each_group_has_six_matches() -> None:
    fixtures = build_canonical_fixtures()
    for letter in "abcdefghijkl":
        group = [f for f in fixtures if f.stage == f"group_{letter}"]
        assert len(group) == 6, f"group_{letter} has {len(group)} matches"


def test_each_group_pair_plays_once() -> None:
    fixtures = build_canonical_fixtures()
    for letter in "ABCDEFGHIJKL":
        group_matches = [f for f in fixtures if f.stage == f"group_{letter.lower()}"]
        # 4 teams, choose 2 -> 6 unordered pairs.
        seen = set()
        for f in group_matches:
            key = frozenset((f.home_team_slot, f.away_team_slot))
            assert key not in seen, f"duplicate pairing in group {letter}"
            seen.add(key)
        assert len(seen) == 6


def test_knockout_stages_have_correct_counts() -> None:
    fixtures = build_canonical_fixtures()
    counts = {
        "r32": 16,
        "r16": 8,
        "qf": 4,
        "sf": 2,
        "third_place": 1,
        "final": 1,
    }
    for stage, expected in counts.items():
        actual = sum(1 for f in fixtures if f.stage == stage)
        assert actual == expected, f"{stage} expected {expected}, got {actual}"


def test_first_match_is_mexico_city_opener() -> None:
    fixtures = build_canonical_fixtures()
    assert fixtures[0].match_number == 1
    assert fixtures[0].host_city_id == "mexico_city"
    assert fixtures[0].kickoff_utc.startswith("2026-06-11")


def test_final_is_match_104_at_metlife() -> None:
    fixtures = build_canonical_fixtures()
    final = fixtures[-1]
    assert final.match_number == 104
    assert final.stage == "final"
    assert final.host_city_id == "new_york_new_jersey"
    assert final.kickoff_utc.startswith("2026-07-19")


def test_kickoff_format_is_iso8601_z() -> None:
    fixtures = build_canonical_fixtures()
    for f in fixtures:
        assert f.kickoff_utc.endswith("Z")
        assert "T" in f.kickoff_utc
        assert len(f.kickoff_utc) == len("2026-06-11T19:00:00Z")


def test_group_kickoffs_are_in_june_2026() -> None:
    fixtures = build_canonical_fixtures()
    group_matches = [f for f in fixtures if f.stage.startswith("group_")]
    for f in group_matches:
        assert f.kickoff_utc.startswith("2026-06"), f.kickoff_utc


def test_knockout_kickoffs_after_group_stage() -> None:
    fixtures = build_canonical_fixtures()
    for f in fixtures:
        if f.stage in ("r32", "r16", "qf", "sf", "third_place", "final"):
            assert f.kickoff_utc >= "2026-06-28", f"{f.match_number} kickoff {f.kickoff_utc}"


def test_determinism_two_builds_are_identical() -> None:
    a = build_canonical_fixtures()
    b = build_canonical_fixtures()
    assert a == b


@pytest.mark.parametrize("letter", list("ABCDEFGHIJKL"))
def test_each_group_has_four_unique_team_slots(letter: str) -> None:
    teams = GROUP_TEAMS_CLEAN[letter]
    assert len(teams) == 4
    assert len(set(teams)) == 4
