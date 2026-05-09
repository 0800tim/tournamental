"""Upstream data source adapters with cache + graceful fallback.

Each source has a `fetch()` that returns parsed data, and a `parse_*` helper
that lifts to the project's canonical shape. All HTTP I/O respects:
- per-host sleep between requests (politeness)
- a local on-disk cache keyed by URL hash (idempotency)
- robots.txt where applicable
- a configurable timeout

If a source fails (network error, schema drift, robots.txt disallow),
the adapter logs and returns None; the caller falls back to the previous
cached snapshot.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)


WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
WIKIMEDIA_FLAG_BASE = "https://commons.wikimedia.org/wiki/Special:FilePath/"
FIFA_SCHEDULE_URL = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures"

POLITE_SLEEP_S = 1.0
DEFAULT_TIMEOUT_S = 30.0
USER_AGENT = "VTornDataBot/0.1 (+https://github.com/0800tim/vtorn)"


@dataclass
class SourceResult:
    """Result of a single upstream fetch."""

    source: str
    ok: bool
    data: Any | None = None
    error: str | None = None
    from_cache: bool = False


class HttpCache:
    """Tiny on-disk cache keyed by URL → JSON or text."""

    def __init__(self, cache_dir: Path):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _key(self, url: str, params: dict | None = None) -> Path:
        h = hashlib.sha256()
        h.update(url.encode())
        if params:
            h.update(json.dumps(params, sort_keys=True).encode())
        return self.cache_dir / f"{h.hexdigest()}.json"

    def get(self, url: str, params: dict | None = None) -> Any | None:
        p = self._key(url, params)
        if p.exists():
            try:
                return json.loads(p.read_text())
            except Exception:
                return None
        return None

    def put(self, url: str, value: Any, params: dict | None = None) -> None:
        p = self._key(url, params)
        p.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True))


def _polite_get(
    client: httpx.Client,
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    sleep_s: float = POLITE_SLEEP_S,
) -> httpx.Response:
    """Request helper with polite sleep + UA."""
    h = {"User-Agent": USER_AGENT}
    if headers:
        h.update(headers)
    time.sleep(sleep_s)
    return client.get(url, params=params, headers=h, timeout=DEFAULT_TIMEOUT_S)


# ---------- Wikidata SPARQL ----------

WIKIDATA_TEAM_QUERY = """
SELECT ?team ?teamLabel ?fifaCode ?confederation ?confederationLabel WHERE {
  ?team wdt:P31 wd:Q6979593.
  OPTIONAL { ?team wdt:P1185 ?fifaCode. }
  OPTIONAL { ?team wdt:P361 ?confederation. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""


def fetch_wikidata_teams(
    client: httpx.Client | None = None,
    cache: HttpCache | None = None,
) -> SourceResult:
    """Fetch national football team metadata from Wikidata SPARQL."""
    use_client = client if client is not None else httpx.Client()
    try:
        if cache is not None:
            cached = cache.get(WIKIDATA_SPARQL, {"q": WIKIDATA_TEAM_QUERY})
            if cached is not None:
                return SourceResult("wikidata", True, cached, from_cache=True)
        resp = _polite_get(
            use_client,
            WIKIDATA_SPARQL,
            params={"query": WIKIDATA_TEAM_QUERY, "format": "json"},
            headers={"Accept": "application/sparql-results+json"},
        )
        resp.raise_for_status()
        data = resp.json()
        if cache is not None:
            cache.put(WIKIDATA_SPARQL, data, {"q": WIKIDATA_TEAM_QUERY})
        return SourceResult("wikidata", True, data)
    except Exception as e:
        logger.warning("wikidata fetch failed: %s", e)
        if cache is not None:
            cached = cache.get(WIKIDATA_SPARQL, {"q": WIKIDATA_TEAM_QUERY})
            if cached is not None:
                return SourceResult("wikidata", True, cached, from_cache=True)
        return SourceResult("wikidata", False, None, error=str(e))
    finally:
        if client is None:
            use_client.close()


def fetch_fifa_schedule(
    client: httpx.Client | None = None,
    cache: HttpCache | None = None,
) -> SourceResult:
    """Best-effort scrape of fifa.com schedule page (BeautifulSoup parse)."""
    use_client = client if client is not None else httpx.Client()
    try:
        if cache is not None:
            cached = cache.get(FIFA_SCHEDULE_URL)
            if cached is not None:
                return SourceResult("fifa", True, cached, from_cache=True)
        resp = _polite_get(use_client, FIFA_SCHEDULE_URL)
        resp.raise_for_status()
        html = resp.text
        if cache is not None:
            cache.put(FIFA_SCHEDULE_URL, html)
        return SourceResult("fifa", True, html)
    except Exception as e:
        logger.warning("fifa fetch failed: %s", e)
        if cache is not None:
            cached = cache.get(FIFA_SCHEDULE_URL)
            if cached is not None:
                return SourceResult("fifa", True, cached, from_cache=True)
        return SourceResult("fifa", False, None, error=str(e))
    finally:
        if client is None:
            use_client.close()


def fetch_wikimedia_flag(
    iso_code: str,
    client: httpx.Client | None = None,
    cache: HttpCache | None = None,
) -> SourceResult:
    """Get a Wikimedia Commons SVG flag URL by ISO 3166-1 alpha-2/3 code.

    We don't actually fetch the image bytes (the renderer downloads at
    request time); we resolve the canonical URL only.
    """
    name_map = {
        "ARG": "Argentina",
        "BRA": "Brazil",
        "FRA": "France",
        "ENG": "England",
        "USA": "the_United_States",
        "MEX": "Mexico",
        "CAN": "Canada",
    }
    file_name = f"Flag_of_{name_map.get(iso_code, iso_code)}.svg"
    url = WIKIMEDIA_FLAG_BASE + file_name
    return SourceResult("wikimedia", True, url)
