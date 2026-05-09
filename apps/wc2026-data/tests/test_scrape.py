"""Tests for scrape CLI + source adapters with mocked HTTP."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import respx

from wc2026_data.canonical_fixtures import build_canonical_fixtures
from wc2026_data.scrape import build_meta, fixtures_to_json, run, write_json
from wc2026_data.sources import (
    FIFA_SCHEDULE_URL,
    WIKIDATA_SPARQL,
    HttpCache,
    fetch_fifa_schedule,
    fetch_wikidata_teams,
)


def test_fixtures_to_json_round_trips() -> None:
    fixtures = build_canonical_fixtures()
    blob = fixtures_to_json(fixtures)
    assert blob["match_count"] == 104
    assert len(blob["fixtures"]) == 104
    assert blob["fixtures"][0]["match_number"] == 1


def test_build_meta_includes_all_three_sources() -> None:
    meta = build_meta(
        sources_used=["fifa", "wikidata", "wikimedia"],
        cached_only=[],
        failed=[],
        scrape_date="2026-05-09",
    )
    ids = {s["id"] for s in meta["sources"]}
    assert ids == {"fifa", "wikidata", "wikimedia"}
    assert all(s["used"] for s in meta["sources"])


def test_build_meta_marks_failed_sources() -> None:
    meta = build_meta(
        sources_used=["wikimedia"],
        cached_only=[],
        failed=["fifa"],
        scrape_date="2026-05-09",
    )
    fifa = next(s for s in meta["sources"] if s["id"] == "fifa")
    assert fifa["failed"] is True
    assert fifa["used"] is False


def test_write_json_is_byte_deterministic(tmp_path: Path) -> None:
    fixtures = build_canonical_fixtures()
    blob = fixtures_to_json(fixtures)
    path1 = tmp_path / "a.json"
    path2 = tmp_path / "b.json"
    write_json(path1, blob)
    write_json(path2, blob)
    assert path1.read_bytes() == path2.read_bytes()


def test_write_json_has_trailing_newline_and_sorted_keys(tmp_path: Path) -> None:
    out = tmp_path / "x.json"
    write_json(out, {"z": 1, "a": 2})
    text = out.read_text()
    assert text.endswith("\n")
    # First non-{ char should be the lowest-key letter "a"
    first_key_pos = text.index('"a"')
    second_key_pos = text.index('"z"')
    assert first_key_pos < second_key_pos


@respx.mock
def test_fetch_wikidata_returns_data_on_200() -> None:
    payload = {"results": {"bindings": [{"team": {"value": "Q170244"}}]}}
    respx.get(WIKIDATA_SPARQL).mock(return_value=httpx.Response(200, json=payload))
    result = fetch_wikidata_teams(httpx.Client(), cache=None)
    assert result.ok
    assert result.data == payload
    assert not result.from_cache


@respx.mock
def test_fetch_wikidata_falls_back_to_cache_on_failure(tmp_path: Path) -> None:
    from wc2026_data.sources import WIKIDATA_TEAM_QUERY
    cache = HttpCache(tmp_path)
    cache.put(WIKIDATA_SPARQL, {"cached": True}, {"q": WIKIDATA_TEAM_QUERY})
    respx.get(WIKIDATA_SPARQL).mock(return_value=httpx.Response(500))
    result = fetch_wikidata_teams(httpx.Client(), cache=cache)
    assert result.ok
    assert result.from_cache
    assert result.data == {"cached": True}


@respx.mock
def test_fetch_wikidata_returns_failure_when_no_cache() -> None:
    respx.get(WIKIDATA_SPARQL).mock(return_value=httpx.Response(500))
    result = fetch_wikidata_teams(httpx.Client(), cache=None)
    assert not result.ok
    assert result.error is not None


@respx.mock
def test_fetch_fifa_schedule_returns_html_on_200() -> None:
    respx.get(FIFA_SCHEDULE_URL).mock(
        return_value=httpx.Response(200, text="<html>schedule</html>"),
    )
    result = fetch_fifa_schedule(httpx.Client(), cache=None)
    assert result.ok
    assert "schedule" in result.data


def test_run_dry_run_writes_nothing(tmp_path: Path) -> None:
    out = tmp_path / "data"
    rc = run(out, dry_run=True, source_only="wikimedia")
    assert rc == 0
    assert not out.exists()


def test_run_full_writes_fixtures_and_meta(tmp_path: Path) -> None:
    out = tmp_path / "data"
    rc = run(out, dry_run=False, source_only="wikimedia")
    assert rc == 0
    assert (out / "fixtures.json").exists()
    assert (out / "_meta.json").exists()
    fixtures = json.loads((out / "fixtures.json").read_text())
    assert fixtures["match_count"] == 104


def test_idempotent_run_produces_byte_identical_output(tmp_path: Path) -> None:
    out_a = tmp_path / "a"
    out_b = tmp_path / "b"
    run(out_a, dry_run=False, source_only="wikimedia")
    run(out_b, dry_run=False, source_only="wikimedia")
    # Compare fixtures.json byte-for-byte (meta has scrape_date which can vary).
    assert (out_a / "fixtures.json").read_bytes() == (out_b / "fixtures.json").read_bytes()


def test_http_cache_round_trips(tmp_path: Path) -> None:
    cache = HttpCache(tmp_path)
    assert cache.get("https://x.test") is None
    cache.put("https://x.test", {"ok": True})
    assert cache.get("https://x.test") == {"ok": True}


def test_http_cache_distinguishes_params(tmp_path: Path) -> None:
    cache = HttpCache(tmp_path)
    cache.put("https://x.test", {"a": 1}, {"q": "alpha"})
    cache.put("https://x.test", {"a": 2}, {"q": "beta"})
    assert cache.get("https://x.test", {"q": "alpha"}) == {"a": 1}
    assert cache.get("https://x.test", {"q": "beta"}) == {"a": 2}
