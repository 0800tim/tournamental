"""Shared test fixtures."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make `wc2026_data` importable without installation.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "src"))

DATA_DIR = _HERE.parents[2] / "data" / "fifa-wc-2026"


@pytest.fixture(scope="session")
def data_dir() -> Path:
    return DATA_DIR


@pytest.fixture(scope="session")
def fixtures_blob(data_dir: Path) -> dict:
    return json.loads((data_dir / "fixtures.json").read_text())


@pytest.fixture(scope="session")
def teams_blob(data_dir: Path) -> dict:
    return json.loads((data_dir / "teams.json").read_text())


@pytest.fixture(scope="session")
def host_cities_blob(data_dir: Path) -> dict:
    return json.loads((data_dir / "host-cities.json").read_text())


@pytest.fixture(scope="session")
def players_blob(data_dir: Path) -> dict:
    return json.loads((data_dir / "players.json").read_text())


@pytest.fixture(scope="session")
def meta_blob(data_dir: Path) -> dict:
    return json.loads((data_dir / "_meta.json").read_text())
