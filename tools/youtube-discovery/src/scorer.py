"""Channel scoring algorithm — 100-point scale."""

from __future__ import annotations

import math
from datetime import datetime, timezone


def score_channel(channel: dict) -> float:
    """
    Score a channel on a 0–100 scale.

    subscribers (log-scaled)    40 pts   reach
    views-per-sub ratio         30 pts   engagement quality
    upload frequency            20 pts   active channel
    recency                     10 pts   not abandoned
    """
    subs = max(channel.get("subscribers", 0), 1)
    views_per_sub = channel.get("views_per_sub", 0)
    uploads_per_month = channel.get("uploads_per_month", 0)
    last_upload = channel.get("last_upload_date", "")

    # Subscribers: log10 scale, 10M subs = max
    sub_score = min(math.log10(subs) / math.log10(10_000_000), 1.0) * 40

    # Engagement: 100 views/sub = max (top creators)
    engagement_score = min(views_per_sub / 100, 1.0) * 30

    # Frequency: 4+ uploads/month = max
    freq_score = min(uploads_per_month / 4, 1.0) * 20

    # Recency: uploaded in last 30 days = max, 30+ days ago = 0
    recency_score = _recency_score(last_upload) * 10

    return round(sub_score + engagement_score + freq_score + recency_score, 1)


def _recency_score(last_upload_date: str) -> float:
    if not last_upload_date:
        return 0.0
    try:
        last = datetime.fromisoformat(last_upload_date.replace("Z", "+00:00"))
        days_ago = (datetime.now(timezone.utc) - last).days
        return max(0.0, (30 - days_ago) / 30)
    except ValueError:
        return 0.0
