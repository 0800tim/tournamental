"""Cross-file consistency checks (host city ids, team codes, slot integrity)."""

from __future__ import annotations


def test_every_fixture_host_city_resolves(
    fixtures_blob: dict, host_cities_blob: dict
) -> None:
    valid_ids = {c["id"] for c in host_cities_blob["host_cities"]}
    for fixture in fixtures_blob["fixtures"]:
        assert fixture["host_city_id"] in valid_ids, fixture


def test_every_concrete_group_team_slot_is_in_teams_json(
    fixtures_blob: dict, teams_blob: dict
) -> None:
    """Every team slot referenced in group fixtures must be a team code in teams.json."""
    valid_codes = {t["code"] for t in teams_blob["teams"]}
    for fixture in fixtures_blob["fixtures"]:
        if fixture["stage"].startswith("group_"):
            for slot in (fixture["home_team_slot"], fixture["away_team_slot"]):
                assert slot in valid_codes, f"Match {fixture['match_number']}: {slot} not in teams.json"


def test_knockout_slots_are_dependency_strings(fixtures_blob: dict) -> None:
    """R32 slots reference group winners/runners-up, R16+ reference prior winners."""
    for fixture in fixtures_blob["fixtures"]:
        if fixture["stage"] == "r32":
            for slot in (fixture["home_team_slot"], fixture["away_team_slot"]):
                # Must start with 1, 2, or 3 (winner / runner-up / 3rd-place)
                assert slot[0] in "123", f"R32 slot {slot} bad"
        if fixture["stage"] in ("r16", "qf", "sf", "final"):
            for slot in (fixture["home_team_slot"], fixture["away_team_slot"]):
                assert slot.startswith(("W", "L", "1", "2", "3")), f"KO slot {slot} bad"


def test_three_host_countries_represented(host_cities_blob: dict) -> None:
    countries = {c["country"] for c in host_cities_blob["host_cities"]}
    assert countries == {"US", "CA", "MX"}


def test_each_qualified_team_has_kit_colours(teams_blob: dict) -> None:
    for team in teams_blob["teams"]:
        if team.get("qualified"):
            assert team["kit"]["primary"].startswith("#")
            assert team["kit"]["secondary"].startswith("#")


def test_each_player_country_is_a_team_code(
    players_blob: dict, teams_blob: dict
) -> None:
    valid = {t["code"] for t in teams_blob["teams"]}
    for p in players_blob["players"]:
        assert p["country"] in valid, p


def test_player_ids_are_unique(players_blob: dict) -> None:
    ids = [p["player_id"] for p in players_blob["players"]]
    assert len(ids) == len(set(ids))


def test_host_cities_have_unique_ids(host_cities_blob: dict) -> None:
    ids = [c["id"] for c in host_cities_blob["host_cities"]]
    assert len(ids) == len(set(ids))


def test_team_codes_are_unique(teams_blob: dict) -> None:
    codes = [t["code"] for t in teams_blob["teams"]]
    assert len(codes) == len(set(codes))


def test_total_qualified_plus_placeholders_equals_48(teams_blob: dict) -> None:
    qualified = sum(1 for t in teams_blob["teams"] if t.get("qualified"))
    placeholders = sum(1 for t in teams_blob["teams"] if not t.get("qualified"))
    assert qualified + placeholders == 48
