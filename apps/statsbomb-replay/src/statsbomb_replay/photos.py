"""Player photo lookup table.

Loads ``data/wc2022-final-players.csv`` and provides a StatsBomb player_id
→ image_url lookup for the AR-FR final's 22 starters. Built once offline
from Wikidata Q-numbers per docs/11.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path

# photos.py is at src/statsbomb_replay/photos.py; the CSV lives at the
# package-root data/ directory, two levels up.
DEFAULT_CSV = Path(__file__).resolve().parents[2] / "data" / "wc2022-final-players.csv"


@dataclass(frozen=True)
class PlayerPhoto:
    player_id: int
    name: str
    number: int
    country: str
    wikidata_q: str
    image_url: str
    attribution: str


def load_photos(csv_path: Path | None = None) -> dict[int, PlayerPhoto]:
    path = csv_path or DEFAULT_CSV
    if not path.exists():
        return {}
    out: dict[int, PlayerPhoto] = {}
    with path.open("r", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            try:
                pid = int(row["player_id"])
            except (KeyError, ValueError):
                continue
            out[pid] = PlayerPhoto(
                player_id=pid,
                name=row.get("name", ""),
                number=int(row.get("number", 0) or 0),
                country=row.get("country", ""),
                wikidata_q=row.get("wikidata_q", ""),
                image_url=row.get("image_url", ""),
                attribution=row.get("attribution", ""),
            )
    return out
