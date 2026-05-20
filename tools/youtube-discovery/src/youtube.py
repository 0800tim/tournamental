"""YouTube Data API v3 wrapper — search and channel stats.

API-key rotation: YOUTUBE_API_KEYS in .env can be a single key or a
comma-separated list. Each key has its own 10,000/day quota; when the
current key hits a quotaExceeded 403, we rotate to the next and retry
the same call. If every key is exhausted, the call returns None and
the per-call caller decides whether to skip or abort.
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

CACHE_DIR = Path(__file__).parent.parent / "cache"

KEYWORD_SETS: list[tuple[str, list[str]]] = [
    ("en", [
        "football predictions",
        "soccer analysis",
        "World Cup 2026",
        "Premier League analysis",
        "Champions League analysis",
        "soccer highlights",
        "football commentary",
    ]),
    ("es", [
        "predicciones fútbol",
        "análisis fútbol",
        "Mundial 2026",
        "Champions League análisis",
        "fútbol highlights",
    ]),
    ("pt", [
        "previsões futebol",
        "análise futebol",
        "Copa do Mundo 2026",
        "futebol brasileiro",
        "highlights futebol",
    ]),
    ("fr", [
        "prédictions football",
        "analyse football",
        "Coupe du Monde 2026",
        "Ligue 1 analyse",
        "football highlights",
    ]),
]


class _KeyPool:
    """Round-robin pool of YouTube API keys.

    Keys are marked exhausted in-process when they 403 with quotaExceeded.
    Once every key is exhausted we surface a single warning and subsequent
    calls return None so callers can skip cleanly.
    """

    def __init__(self) -> None:
        # Accept either YOUTUBE_API_KEYS (plural, preferred for pools) or
        # YOUTUBE_API_KEY (singular, back-compat). Both can be comma-separated.
        raw = (
            os.environ.get("YOUTUBE_API_KEYS")
            or os.environ.get("YOUTUBE_API_KEY")
            or ""
        )
        # Tolerate JSON-array-style brackets, surrounding quotes, and whitespace.
        raw = raw.strip().strip("[]").strip()
        self._keys = [
            k.strip().strip('"').strip("'")
            for k in raw.split(",")
            if k.strip().strip('"').strip("'")
        ]
        if not self._keys:
            raise RuntimeError(
                "YOUTUBE_API_KEYS (or YOUTUBE_API_KEY) missing or empty in .env."
            )
        self._exhausted: set[str] = set()
        self._idx = 0
        self._client_cache: dict[str, Any] = {}
        self._announced_exhausted = False

    def current_key(self) -> Optional[str]:
        for _ in range(len(self._keys)):
            key = self._keys[self._idx]
            if key not in self._exhausted:
                return key
            self._idx = (self._idx + 1) % len(self._keys)
        return None

    def client(self) -> Optional[Any]:
        key = self.current_key()
        if key is None:
            return None
        if key not in self._client_cache:
            self._client_cache[key] = build(
                "youtube", "v3", developerKey=key, cache_discovery=False
            )
        return self._client_cache[key]

    def mark_exhausted(self) -> None:
        key = self._keys[self._idx]
        if key not in self._exhausted:
            self._exhausted.add(key)
            print(
                f"  [info] API key #{self._idx + 1} of {len(self._keys)} exhausted; "
                f"rotating ({len(self._exhausted)}/{len(self._keys)} burned)."
            )
        self._idx = (self._idx + 1) % len(self._keys)

    def all_exhausted(self) -> bool:
        return len(self._exhausted) >= len(self._keys)

    def announce_exhausted_once(self) -> None:
        if not self._announced_exhausted:
            print(
                f"  [warn] All {len(self._keys)} YouTube API keys exhausted today. "
                "Remaining calls will be skipped. Re-run after 00:00 Pacific or add more keys."
            )
            self._announced_exhausted = True


_pool: Optional[_KeyPool] = None


def _get_pool() -> _KeyPool:
    global _pool
    if _pool is None:
        _pool = _KeyPool()
    return _pool


def _is_quota_error(e: HttpError) -> bool:
    """True iff the HttpError is a 403 quotaExceeded / dailyLimitExceeded."""
    if e.resp.status != 403:
        return False
    body = (e.content or b"").decode("utf-8", errors="ignore").lower()
    return "quota" in body or "dailylimitexceeded" in body or "ratelimitexceeded" in body


def _call_with_rotation(builder: Callable[[Any], Any]) -> Optional[dict]:
    """Run an API call with key rotation.

    `builder(client)` should return the unexecuted request object
    (e.g. `client.channels().list(...)`); we execute it here so we
    can rebuild on rotation.
    """
    pool = _get_pool()

    while True:
        client = pool.client()
        if client is None:
            pool.announce_exhausted_once()
            return None
        try:
            return builder(client).execute()
        except HttpError as e:
            if _is_quota_error(e):
                pool.mark_exhausted()
                continue
            raise


def _build_client() -> Any:
    """Back-compat single-client builder."""
    c = _get_pool().client()
    if c is None:
        raise RuntimeError("All YouTube API keys exhausted.")
    return c


def search_channels(max_results_per_keyword: int = 50) -> dict[str, dict]:
    """Return {channel_id: {language, channel_id}} for all keyword hits."""
    found: dict[str, dict] = {}

    for language, keywords in KEYWORD_SETS:
        for keyword in keywords:
            try:
                resp = _call_with_rotation(
                    lambda c, kw=keyword, lang=language: c.search().list(
                        part="snippet",
                        q=kw,
                        type="channel",
                        relevanceLanguage=lang,
                        maxResults=min(max_results_per_keyword, 50),
                    )
                )
            except HttpError as e:
                print(f"  [warn] search failed for '{keyword}': {e}")
                continue
            if resp is None:
                continue

            for item in resp.get("items", []):
                cid = item["id"]["channelId"]
                if cid not in found:
                    found[cid] = {
                        "channel_id": cid,
                        "primary_language": language,
                    }

    return found


def fetch_channel_stats(channel_ids: list[str]) -> dict[str, dict]:
    """Batch-fetch full stats for a list of channel IDs (50 per API call).

    Quota cost: 1 unit per batch of 50 channels.
    """
    results: dict[str, dict] = {}

    for i in range(0, len(channel_ids), 50):
        batch = channel_ids[i : i + 50]
        try:
            resp = _call_with_rotation(
                lambda c, b=batch: c.channels().list(
                    part="snippet,statistics,contentDetails",
                    id=",".join(b),
                    maxResults=50,
                )
            )
        except HttpError as e:
            print(f"  [warn] channels.list failed for batch {i}: {e}")
            continue
        if resp is None:
            continue

        for item in resp.get("items", []):
            cid = item["id"]
            stats = item.get("statistics", {})
            snippet = item.get("snippet", {})
            content_details = item.get("contentDetails", {})
            uploads_playlist = (
                content_details.get("relatedPlaylists", {}).get("uploads", "")
            )

            published_at = snippet.get("publishedAt", "")
            channel_age_days = _channel_age_days(published_at)
            total_uploads = int(stats.get("videoCount", 0))
            uploads_per_month = (
                total_uploads / (channel_age_days / 30)
                if channel_age_days > 0
                else 0
            )

            subscribers = int(stats.get("subscriberCount", 0))
            total_views = int(stats.get("viewCount", 0))
            views_per_sub = total_views / subscribers if subscribers > 0 else 0

            custom_url = snippet.get("customUrl", "")
            description = snippet.get("description", "")
            country = snippet.get("country", "")

            results[cid] = {
                "channel_id": cid,
                "channel_name": snippet.get("title", ""),
                "channel_url": f"https://www.youtube.com/channel/{cid}",
                "custom_url": custom_url,
                "country": country,
                "description_preview": description[:500],
                "subscribers": subscribers,
                "total_views": total_views,
                "views_per_sub": round(views_per_sub, 2),
                "uploads_per_month": round(uploads_per_month, 1),
                "last_upload_date": "",  # filled by fetch_last_upload_dates
                "published_at": published_at,
                "uploads_playlist_id": uploads_playlist,
            }

    return results


def fetch_last_upload_dates(channels_with_stats: dict[str, dict]) -> dict[str, str]:
    """Return {channel_id: ISO-date-string} for the most recent upload.

    Uses playlistItems.list against the channel's uploads playlist (1 quota unit
    per call), not search.list (100 units per call). 1000 channels = 1000 units
    instead of 100,000.
    """
    dates: dict[str, str] = {}

    for cid, ch in channels_with_stats.items():
        playlist_id = ch.get("uploads_playlist_id")
        if not playlist_id:
            dates[cid] = ""
            continue
        try:
            resp = _call_with_rotation(
                lambda c, pid=playlist_id: c.playlistItems().list(
                    part="snippet",
                    playlistId=pid,
                    maxResults=1,
                )
            )
        except HttpError:
            dates[cid] = ""
            continue
        if resp is None:
            dates[cid] = ""
            continue
        items = resp.get("items", [])
        dates[cid] = items[0]["snippet"].get("publishedAt", "") if items else ""

    return dates


def backfill_snippet_fields(channels_with_stats: dict[str, dict]) -> None:
    """Mutate channels in-place, adding country/custom_url/description for any
    channel missing those fields (older cache entries don't have them).

    Costs 1 quota unit per 50 channels (~20 units for a 1000-channel cache).
    """
    missing = [
        cid for cid, ch in channels_with_stats.items()
        if "country" not in ch or "custom_url" not in ch
    ]
    if not missing:
        return

    print(f"  Backfilling country/custom_url/description for {len(missing)} cached channels...")

    for i in range(0, len(missing), 50):
        batch = missing[i : i + 50]
        try:
            resp = _call_with_rotation(
                lambda c, b=batch: c.channels().list(
                    part="snippet",
                    id=",".join(b),
                    maxResults=50,
                )
            )
        except HttpError as e:
            print(f"  [warn] snippet backfill failed for batch {i}: {e}")
            continue
        if resp is None:
            continue
        for item in resp.get("items", []):
            cid = item["id"]
            snippet = item.get("snippet", {})
            ch = channels_with_stats.get(cid)
            if ch is None:
                continue
            ch.setdefault("custom_url", snippet.get("customUrl", ""))
            ch.setdefault("country", snippet.get("country", ""))
            ch.setdefault("description_preview", snippet.get("description", "")[:500])


def fetch_recent_video_titles(channel_id: str, n: int = 5) -> list[str]:
    """Return titles of the N most recent videos — used for pitch personalisation."""
    try:
        resp = _call_with_rotation(
            lambda c, cid=channel_id, n=n: c.search().list(
                part="snippet",
                channelId=cid,
                order="date",
                type="video",
                maxResults=n,
            )
        )
    except HttpError:
        return []
    if resp is None:
        return []
    return [item["snippet"]["title"] for item in resp.get("items", [])]


def load_cache() -> dict[str, dict] | None:
    path = CACHE_DIR / "channels.json"
    if path.exists():
        return json.loads(path.read_text())
    return None


def save_cache(data: dict[str, dict]) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    (CACHE_DIR / "channels.json").write_text(json.dumps(data, indent=2))


def _channel_age_days(published_at: str) -> float:
    if not published_at:
        return 365
    try:
        created = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - created).days
    except ValueError:
        return 365
