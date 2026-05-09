"""Validate every JSON file in data/fifa-wc-2026/ against its schema."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator


def _load_schema(name: str, data_dir: Path) -> dict:
    return json.loads((data_dir / "schema" / name).read_text())


def test_fixtures_match_schema(data_dir: Path, fixtures_blob: dict) -> None:
    schema = _load_schema("fixtures.schema.json", data_dir)
    Draft202012Validator(schema).validate(fixtures_blob)


def test_teams_match_schema(data_dir: Path, teams_blob: dict) -> None:
    schema = _load_schema("teams.schema.json", data_dir)
    Draft202012Validator(schema).validate(teams_blob)


def test_host_cities_match_schema(data_dir: Path, host_cities_blob: dict) -> None:
    schema = _load_schema("host-cities.schema.json", data_dir)
    Draft202012Validator(schema).validate(host_cities_blob)


def test_players_match_schema(data_dir: Path, players_blob: dict) -> None:
    schema = _load_schema("players.schema.json", data_dir)
    Draft202012Validator(schema).validate(players_blob)


def test_meta_match_schema(data_dir: Path, meta_blob: dict) -> None:
    schema = _load_schema("meta.schema.json", data_dir)
    Draft202012Validator(schema).validate(meta_blob)


def test_fixtures_count_is_104(fixtures_blob: dict) -> None:
    assert len(fixtures_blob["fixtures"]) == 104
    assert fixtures_blob["match_count"] == 104


def test_teams_count_is_48(teams_blob: dict) -> None:
    assert len(teams_blob["teams"]) == 48


def test_host_cities_count_is_16(host_cities_blob: dict) -> None:
    assert len(host_cities_blob["host_cities"]) == 16


@pytest.mark.parametrize("country", ["US", "CA", "MX"])
def test_each_host_country_has_cities(host_cities_blob: dict, country: str) -> None:
    matched = [c for c in host_cities_blob["host_cities"] if c["country"] == country]
    assert matched, f"No host cities for {country}"
