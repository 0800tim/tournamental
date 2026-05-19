"""YouTube Data API v3 wrapper — search and channel stats."""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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


def _build_client() -> Any:
    api_key = os.environ["YOUTUBE_API_KEY"]
    return build("youtube", "v3", developerKey=api_key)


def search_channels(max_results_per_keyword: int = 50) -> dict[str, dict]:
    """Return {channel_id: {language, channel_id}} for all keyword hits."""
    client = _build_client()
    found: dict[str, dict] = {}

    for language, keywords in KEYWORD_SETS:
        for keyword in keywords:
            try:
                resp = client.search().list(
                    part="snippet",
                    q=keyword,
                    type="channel",
                    relevanceLanguage=language,
                    maxResults=min(max_results_per_keyword, 50),
                ).execute()
            except HttpError as e:
                print(f"  [warn] search failed for '{keyword}': {e}")
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
    """Batch-fetch full stats for a list of channel IDs (50 per API call)."""
    client = _build_client()
    results: dict[str, dict] = {}

    for i in range(0, len(channel_ids), 50):
        batch = channel_ids[i : i + 50]
        try:
            resp = client.channels().list(
                part="snippet,statistics,contentDetails",
                id=",".join(batch),
                maxResults=50,
            ).execute()
        except HttpError as e:
            print(f"  [warn] channels.list failed for batch {i}: {e}")
            continue

        for item in resp.get("items", []):
            cid = item["id"]
            stats = item.get("statistics", {})
            snippet = item.get("snippet", {})

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

            results[cid] = {
                "channel_id": cid,
                "channel_name": snippet.get("title", ""),
                "channel_url": f"https://www.youtube.com/channel/{cid}",
                "subscribers": subscribers,
                "total_views": total_views,
                "views_per_sub": round(views_per_sub, 2),
                "uploads_per_month": round(uploads_per_month, 1),
                "last_upload_date": "",  # filled by fetch_last_upload_dates
                "published_at": published_at,
            }

    return results


def fetch_last_upload_dates(channel_ids: list[str]) -> dict[str, str]:
    """Return {channel_id: ISO-date-string} for the most recent upload."""
    client = _build_client()
    dates: dict[str, str] = {}

    for cid in channel_ids:
        try:
            resp = client.search().list(
                part="snippet",
                channelId=cid,
                order="date",
                type="video",
                maxResults=1,
            ).execute()
            items = resp.get("items", [])
            if items:
                dates[cid] = items[0]["snippet"].get("publishedAt", "")
        except HttpError:
            dates[cid] = ""

    return dates


def fetch_recent_video_titles(channel_id: str, n: int = 5) -> list[str]:
    """Return titles of the N most recent videos — used for pitch personalisation."""
    client = _build_client()
    try:
        resp = client.search().list(
            part="snippet",
            channelId=channel_id,
            order="date",
            type="video",
            maxResults=n,
        ).execute()
        return [item["snippet"]["title"] for item in resp.get("items", [])]
    except HttpError:
        return []


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
