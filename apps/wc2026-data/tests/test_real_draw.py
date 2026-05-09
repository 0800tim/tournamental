"""Tests for the real 2026 FIFA WC draw data (post-Final-Draw, post-March-2026 play-offs)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "data" / "fifa-wc-2026"


@pytest.fixture(scope="module")
def teams_blob() -> dict:
    return json.loads((DATA_DIR / "teams.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def fixtures_blob() -> dict:
    return json.loads((DATA_DIR / "fixtures.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def meta_blob() -> dict:
    return json.loads((DATA_DIR / "_meta.json").read_text(encoding="utf-8"))


def test_teams_json_has_exactly_48_teams(teams_blob: dict) -> None:
    assert len(teams_blob["teams"]) == 48


def test_no_play_off_placeholders_remain(teams_blob: dict) -> None:
    """All UPO/IPO placeholder slots must have been replaced by real teams."""
    placeholder_codes = {"UPO1", "UPO2", "UPO3", "UPO4", "IPO1", "IPO2"}
    codes = {t["code"] for t in teams_blob["teams"]}
    assert codes.isdisjoint(placeholder_codes), (
        f"placeholder codes still present: {codes & placeholder_codes}"
    )


def test_every_team_has_a_real_fifa_code(teams_blob: dict) -> None:
    """Codes must be 2-5 chars (allows ENG / IRQ / WAL etc.) and never blank."""
    for t in teams_blob["teams"]:
        assert t["code"], t
        assert 2 <= len(t["code"]) <= 5, t["code"]
        assert t["code"].isupper(), t["code"]


def test_every_team_is_qualified(teams_blob: dict) -> None:
    """No provisional/Italy-style entries left."""
    for t in teams_blob["teams"]:
        assert t["qualified"] is True, t["code"]


def test_real_play_off_winners_present(teams_blob: dict) -> None:
    """The real March 2026 play-off winners must be in the team list."""
    codes = {t["code"] for t in teams_blob["teams"]}
    expected = {"BIH", "SWE", "TUR", "CZE", "COD", "IRQ"}
    missing = expected - codes
    assert not missing, f"missing real play-off winners: {missing}"


def test_fixtures_json_has_exactly_104_matches(fixtures_blob: dict) -> None:
    assert fixtures_blob["match_count"] == 104
    assert len(fixtures_blob["fixtures"]) == 104


def test_fixtures_stage_breakdown(fixtures_blob: dict) -> None:
    counts: dict[str, int] = {}
    for f in fixtures_blob["fixtures"]:
        counts[f["stage"]] = counts.get(f["stage"], 0) + 1

    group_total = sum(v for k, v in counts.items() if k.startswith("group_"))
    assert group_total == 72, counts
    assert counts["r32"] == 16
    assert counts["r16"] == 8
    assert counts["qf"] == 4
    assert counts["sf"] == 2
    assert counts["third_place"] == 1
    assert counts["final"] == 1


@pytest.mark.parametrize("letter", list("abcdefghijkl"))
def test_each_group_has_4_teams_and_6_unique_pairings(
    fixtures_blob: dict, letter: str
) -> None:
    matches = [f for f in fixtures_blob["fixtures"] if f["stage"] == f"group_{letter}"]
    assert len(matches) == 6, letter

    teams_in_group: set[str] = set()
    for m in matches:
        teams_in_group.add(m["home_team_slot"])
        teams_in_group.add(m["away_team_slot"])
    assert len(teams_in_group) == 4, (letter, teams_in_group)

    pairings = {frozenset((m["home_team_slot"], m["away_team_slot"])) for m in matches}
    assert len(pairings) == 6, letter


def test_match_dates_within_window(fixtures_blob: dict) -> None:
    """All matches between 2026-06-11 (opener) and 2026-07-19 (final), inclusive."""
    for f in fixtures_blob["fixtures"]:
        assert "2026-06-11" <= f["kickoff_utc"][:10] <= "2026-07-19", f


def test_each_team_plays_exactly_three_group_matches(fixtures_blob: dict) -> None:
    counts: dict[str, int] = {}
    for f in fixtures_blob["fixtures"]:
        if not f["stage"].startswith("group_"):
            continue
        counts[f["home_team_slot"]] = counts.get(f["home_team_slot"], 0) + 1
        counts[f["away_team_slot"]] = counts.get(f["away_team_slot"], 0) + 1
    assert len(counts) == 48, len(counts)
    for code, n in counts.items():
        assert n == 3, (code, n)


def test_host_nations_seeded_into_a_b_d(fixtures_blob: dict) -> None:
    """FIFA convention: hosts go to A1, B1, D1."""
    first_match: dict[str, str] = {}
    for letter in "abcdefghijkl":
        ms = sorted(
            (f for f in fixtures_blob["fixtures"] if f["stage"] == f"group_{letter}"),
            key=lambda f: f["match_number"],
        )
        first_match[letter] = ms[0]["home_team_slot"]
    assert first_match["a"] == "MEX"
    assert first_match["b"] == "CAN"
    assert first_match["d"] == "USA"


def test_no_team_appears_in_two_groups(fixtures_blob: dict) -> None:
    teams_by_group: dict[str, set[str]] = {}
    for f in fixtures_blob["fixtures"]:
        if not f["stage"].startswith("group_"):
            continue
        teams_by_group.setdefault(f["stage"], set()).update(
            {f["home_team_slot"], f["away_team_slot"]}
        )
    seen: dict[str, str] = {}
    for stage, codes in teams_by_group.items():
        for code in codes:
            if code in seen and seen[code] != stage:
                raise AssertionError(f"{code} appears in {seen[code]} and {stage}")
            seen[code] = stage


def test_meta_documents_real_draw_resolution(meta_blob: dict) -> None:
    res = meta_blob.get("draw_resolution")
    assert res, "expected draw_resolution block in _meta.json"
    assert res["draw_date"] == "2025-12-05"
    assert set(res["uefa_playoff_winners"]) == {"BIH", "SWE", "TUR", "CZE"}
    assert set(res["intercontinental_playoff_winners"]) == {"COD", "IRQ"}


def test_argentina_and_brazil_in_different_groups(fixtures_blob: dict) -> None:
    """Sanity check that the draw kept top seeds apart."""
    arg_group = next(
        f["stage"] for f in fixtures_blob["fixtures"]
        if f["stage"].startswith("group_") and "ARG" in (f["home_team_slot"], f["away_team_slot"])
    )
    bra_group = next(
        f["stage"] for f in fixtures_blob["fixtures"]
        if f["stage"].startswith("group_") and "BRA" in (f["home_team_slot"], f["away_team_slot"])
    )
    assert arg_group != bra_group, (arg_group, bra_group)
