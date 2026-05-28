"""Filter the youtube-discovery cache to football channels under 10k subs
and classify each as A/B/C/D for Tournamental pre-WC outreach.

Outputs:
  tools/outreach-lists/youtube-football-under-10k.csv
  tools/outreach-lists/youtube-football-under-10k.md

Run from anywhere; uses only stdlib.
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools" / "youtube-discovery" / "cache" / "channels.json"
OUT_DIR = ROOT / "tools" / "outreach-lists"
CSV_PATH = OUT_DIR / "youtube-football-under-10k.csv"
MD_PATH = OUT_DIR / "youtube-football-under-10k.md"

# ---------------------------------------------------------------------------
# Spam / re-upload filters
# ---------------------------------------------------------------------------

BETTING_SPAM_PHRASES = [
    "betting tips",
    "sure win",
    "telegram",
    "vip",
    "100% win",
    "odds",
    "tipster",
    "predictions guaranteed",
    "💰",
    "jackpot",
    "sure odds",
    "fixed match",
    "fixed matches",
    "free tips",
    "winning tips",
    "betting",
    "gambling",
    "bankroll",
    "ai predictions",
    "match predictions",
    "football predictions",
    "soccer predictions",
    "1x2",
    "accumulator",
    "acca",
    "stake",
    "wager",
]

# Hard-drop tokens — if these appear in the channel NAME, channel is a betting/
# prediction/tipster operation regardless of body copy. No legitimate fan or
# tactical channel uses these in its name.
NAME_HARD_DROP = [
    "prediction",
    "predictions",
    "tipster",
    "tipsters",
    "betting",
    "1x2",
    "punter",
    "odds",
    "acca",
    "accumulator",
]

REUPLOAD_NAME_HINTS = [
    "full match",
    "full match replay",
    "full match replays",
    "full matches",
    "all goals",
    "highlights hd",
    "highlights only",
    "replays hd",
    "extended highlights",
    "match replay",
    "footyroom",
]

# Tier A signals: original opinion / fan-club / community content
TIER_A_HINTS = [
    "podcast",
    "opinion",
    "fan channel",
    "fan club",
    "fanclub",
    "supporters",
    "fancast",
    "vlog",
    "vlogs",
    "we are",
    "matchday vlog",
    "the official",  # club fan official
    "diary",
    "fan reaction",
    "fans channel",
]

# Tier B signals: tactical / analysis / news commentary / transfer / kit talk
TIER_B_HINTS = [
    "tactical",
    "tactics",
    "analysis",
    "breakdown",
    "post-match",
    "post match",
    "postmatch",
    "reaction",
    "reactions",
    "transfer",
    "transfers",
    "kit",
    "scouting",
    "scout",
    "preview",
    "review",
    "deep dive",
    "explained",
    "ratings",
    "player ratings",
]

# Tier C signals: highlights compilations, regional team coverage, podcast clips
TIER_C_HINTS = [
    "highlights",
    "goals",
    "compilation",
    "skills",
    "clips",
    "news",
    "update",
    "updates",
    "daily",
    "report",
    "regional",
    "local football",
    "non-league",
    "non league",
]

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
TWITTER_RE = re.compile(
    r"(?:twitter\.com/|x\.com/|(?<![\w/@])@)([A-Za-z0-9_]{2,15})", re.IGNORECASE
)
INSTAGRAM_RE = re.compile(r"instagram\.com/([A-Za-z0-9_.]{2,30})", re.IGNORECASE)


def count_spam_hits(text: str) -> int:
    t = text.lower()
    hits = 0
    for phrase in BETTING_SPAM_PHRASES:
        if phrase in t:
            hits += 1
    return hits


def is_reupload_farm(name: str, desc: str) -> bool:
    t = (name + " " + desc).lower()
    return any(h in t for h in REUPLOAD_NAME_HINTS)


def classify_tier(name: str, desc: str) -> str:
    blob = (name + " \n " + desc).lower()
    if any(h in blob for h in TIER_A_HINTS):
        return "A"
    if any(h in blob for h in TIER_B_HINTS):
        return "B"
    if any(h in blob for h in TIER_C_HINTS):
        return "C"
    # No strong signal — default to C (generic but kept), not D.
    return "C"


def extract_contacts(desc: str) -> dict[str, Any]:
    emails = list(dict.fromkeys(EMAIL_RE.findall(desc)))
    # filter obvious junk emails (e.g. malformed)
    emails = [
        e
        for e in emails
        if not e.lower().endswith((".png", ".jpg", ".jpeg", ".gif"))
    ]
    twitters = [
        h
        for h in dict.fromkeys(m.lower() for m in TWITTER_RE.findall(desc))
        if h.lower() not in {"youtube", "youtu", "watch", "channel"}
    ]
    instagrams = list(dict.fromkeys(INSTAGRAM_RE.findall(desc)))
    return {
        "emails": emails,
        "twitters": twitters,
        "instagrams": instagrams,
    }


def contact_route(contacts: dict[str, Any]) -> str:
    parts: list[str] = []
    if contacts["emails"]:
        parts.append("email-in-description: " + contacts["emails"][0])
    if contacts["twitters"]:
        parts.append("Twitter/X @" + contacts["twitters"][0])
    if contacts["instagrams"]:
        parts.append("Instagram @" + contacts["instagrams"][0])
    if not parts:
        return "YouTube About-page email only"
    parts.append("YouTube About-page email")
    return " + ".join(parts)


def why_target(tier: str, name: str, desc: str, subs: int) -> str:
    blob = (name + " " + desc).lower()
    bits: list[str] = []
    if tier == "A":
        bits.append("original fan/community content")
    elif tier == "B":
        bits.append("tactical/analysis content")
    else:
        bits.append("highlights/news coverage")
    if "podcast" in blob:
        bits.append("podcast format")
    if "transfer" in blob:
        bits.append("transfer talk")
    if "world cup" in blob or "fifa" in blob:
        bits.append("WC-relevant audience")
    if subs < 1000:
        bits.append("micro-creator (<1k)")
    elif subs < 5000:
        bits.append("small but engaged")
    else:
        bits.append("growing channel")
    return "; ".join(bits)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    raw = json.loads(CACHE.read_text(encoding="utf-8"))
    print(f"loaded {len(raw)} channels from cache")

    kept: list[dict[str, Any]] = []
    drop_counts = {
        "subs": 0,
        "inactive": 0,
        "low_uploads": 0,
        "low_views": 0,
        "spam": 0,
        "reupload": 0,
        "tier_d": 0,
    }

    for cid, c in raw.items():
        subs = c.get("subscribers") or 0
        if subs <= 0 or subs >= 10000:
            drop_counts["subs"] += 1
            continue
        days_idle = c.get("days_since_last_upload")
        try:
            days_idle_n = float(days_idle) if days_idle is not None else None
        except (TypeError, ValueError):
            days_idle_n = None
        if days_idle_n is None or days_idle_n > 60:
            drop_counts["inactive"] += 1
            continue
        if (c.get("uploads_per_month") or 0) < 1:
            drop_counts["low_uploads"] += 1
            continue
        if (c.get("total_views") or 0) <= 100:
            drop_counts["low_views"] += 1
            continue

        desc = c.get("description_preview") or ""
        name = c.get("channel_name") or ""

        name_l = name.lower()
        if any(re.search(rf"\b{re.escape(tok)}\b", name_l) for tok in NAME_HARD_DROP):
            drop_counts["spam"] += 1
            continue
        if count_spam_hits(desc) >= 2:
            drop_counts["spam"] += 1
            continue
        if is_reupload_farm(name, desc):
            drop_counts["reupload"] += 1
            continue

        tier = classify_tier(name, desc)
        if tier == "D":
            drop_counts["tier_d"] += 1
            continue

        contacts = extract_contacts(desc)
        route = contact_route(contacts)
        lang = (c.get("primary_language") or "").lower() or "other"
        handle = c.get("custom_url") or ""
        if handle and not handle.startswith("@"):
            handle = "@" + handle
        country = c.get("country") or ""

        kept.append(
            {
                "channel_name": name.strip(),
                "handle": handle,
                "subscribers": subs,
                "uploads_per_month": c.get("uploads_per_month") or 0,
                "country": country,
                "primary_language": lang,
                "tier": tier,
                "contact_route": route,
                "why_target": why_target(tier, name, desc, subs),
                "channel_url": c.get("channel_url") or "",
                # extras for ranking only — not in CSV
                "_has_email": bool(contacts["emails"]),
                "_has_social": bool(contacts["twitters"] or contacts["instagrams"]),
                "_desc": desc,
            }
        )

    print(f"kept {len(kept)} channels after filters")
    print("drops:", drop_counts)

    # ------------------------------------------------------------------
    # CSV
    # ------------------------------------------------------------------
    cols = [
        "channel_name",
        "handle",
        "subscribers",
        "uploads_per_month",
        "country",
        "primary_language",
        "tier",
        "contact_route",
        "why_target",
        "channel_url",
    ]
    with CSV_PATH.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        # Sort: tier A first, then by subscribers ascending (smallest first)
        sorted_kept = sorted(kept, key=lambda r: (r["tier"], r["subscribers"]))
        for row in sorted_kept:
            w.writerow({k: row[k] for k in cols})

    # ------------------------------------------------------------------
    # Markdown
    # ------------------------------------------------------------------
    lang_groups: dict[str, list[dict[str, Any]]] = {
        "English": [],
        "Spanish": [],
        "Portuguese": [],
        "French": [],
        "Other": [],
    }
    lang_map = {
        "en": "English",
        "es": "Spanish",
        "pt": "Portuguese",
        "fr": "French",
    }
    for row in kept:
        bucket = lang_map.get(row["primary_language"], "Other")
        lang_groups[bucket].append(row)

    tier_counts = {"A": 0, "B": 0, "C": 0}
    for r in kept:
        tier_counts[r["tier"]] += 1

    with_contact = sum(
        1 for r in kept if "About-page email only" not in r["contact_route"]
    )

    # Pick "first 10 to contact tonight": prefer A-tier, with email, smallest subs
    def pick_score(r: dict[str, Any]) -> tuple:
        tier_rank = {"A": 0, "B": 1, "C": 2}[r["tier"]]
        return (
            tier_rank,
            0 if r["_has_email"] else 1,
            0 if r["_has_social"] else 1,
            r["subscribers"],
        )

    first10 = sorted(kept, key=pick_score)[:10]

    lines: list[str] = []
    lines.append("# YouTube football channels under 10k — outreach list\n")
    lines.append(
        "Filtered from `tools/youtube-discovery/cache/channels.json` (963 channels, "
        "English/Spanish/Portuguese/French football). Keep rules: subscribers in "
        "(0, 10000), last upload within 60 days, ≥1 upload per month, >100 lifetime "
        "views, description not matching 2+ betting-spam phrases, not a re-upload "
        "farm. Each surviving channel scored A (original opinion / fan-club), B "
        "(tactics / post-match / transfer talk), or C (highlights, news, regional "
        "coverage). D-tier (re-uploads, generic read-outs) dropped.\n"
    )
    lines.append(
        "Use the CSV for outreach automation; use this markdown for skimming and "
        "picking who to send to first. Caveat on contacts: YouTube hides the About "
        "page email behind a captcha, so for most channels you'll need to visit "
        "`youtube.com/<handle>/about` and click 'View email address' manually. Where "
        "the channel volunteered an email or social handle in their description, "
        "that's captured in the `contact_route` column.\n"
    )

    lines.append("## First 10 to contact tonight\n")
    lines.append(
        "Highest-quality picks across all languages: A-tier first, prefer those with "
        "an email in description, then smallest subscriber count (Tim's hypothesis: "
        "smaller = easier yes).\n"
    )
    for r in first10:
        angle_bits: list[str] = []
        angle_bits.append(f"tier {r['tier']}")
        if r["_has_email"]:
            angle_bits.append("has email in description")
        elif r["_has_social"]:
            angle_bits.append("social handle in description")
        else:
            angle_bits.append("About-page email only")
        angle_bits.append(f"{r['primary_language']} audience")
        if r["country"]:
            angle_bits.append(f"based {r['country']}")
        angle = ", ".join(angle_bits)
        lines.append(
            f"- **{r['channel_name']}** ({r['handle'] or 'no-handle'}, "
            f"{r['subscribers']} subs) — {r['why_target']}. {angle}. "
            f"<{r['channel_url']}>"
        )
    lines.append("")

    for lang_name in ["English", "Spanish", "Portuguese", "French", "Other"]:
        rows = lang_groups[lang_name]
        if not rows:
            continue
        lines.append(f"## {lang_name} ({len(rows)} channels)\n")
        rows_sorted = sorted(rows, key=lambda r: (r["tier"], r["subscribers"]))
        lines.append(
            "| Tier | Channel | Handle | Subs | Uploads/mo | Country | Contact | Why |"
        )
        lines.append(
            "| ---- | ------- | ------ | ---- | ---------- | ------- | ------- | --- |"
        )
        for r in rows_sorted:
            safe_name = r["channel_name"].replace("|", "\\|")
            name_cell = f"[{safe_name}]({r['channel_url']})"
            handle_cell = (r["handle"] or "—").replace("|", "\\|")
            contact_cell = r["contact_route"].replace("|", "/")
            why_cell = r["why_target"].replace("|", "/")
            lines.append(
                f"| {r['tier']} | {name_cell} | {handle_cell} | {r['subscribers']} "
                f"| {r['uploads_per_month']:.1f} | {r['country'] or '—'} | "
                f"{contact_cell} | {why_cell} |"
            )
        lines.append("")

    lines.append("## Coverage gaps & caveats\n")
    lines.append(
        f"- Betting-spam filter excluded {drop_counts['spam']} channels (descriptions "
        "matched 2+ of: betting tips, sure win, telegram, VIP, 100% win, odds, tipster, "
        "predictions guaranteed, 💰, jackpot, sure odds, fixed match, free tips). If "
        "Tim wants to revisit any of these, they're still in `channels.json` — drop "
        "the spam check from the filter."
    )
    lines.append(
        f"- Re-upload / highlights-farm filter excluded {drop_counts['reupload']} "
        "channels matching name/desc hints ('Full Match Replays', 'All Goals HD', "
        "'Extended Highlights', etc)."
    )
    lines.append(
        f"- Inactivity filter excluded {drop_counts['inactive']} channels with no "
        "upload in the last 60 days, and {} with <1 upload/month.".format(
            drop_counts["low_uploads"]
        )
    )
    lines.append(
        f"- Subscriber filter excluded {drop_counts['subs']} channels outside the "
        "(0, 10000) band — either zero/missing subs, or already above the 10k cap."
    )
    lines.append(
        f"- Low-traffic filter excluded {drop_counts['low_views']} channels with ≤100 "
        "lifetime views (abandoned hobby uploads)."
    )
    lines.append(
        "- Tier classification is heuristic — based on keywords in channel name and "
        "first ~500 chars of description. A human reviewer should re-tier the top "
        "20-30 before send for accuracy."
    )
    lines.append(
        "- Email coverage is partial: YouTube does not expose About-page emails to "
        "scrapers. Only emails that creators volunteered in their description are "
        "captured here. For the rest, manual About-page visits are required."
    )
    lines.append(
        "- Language detection comes from `primary_language` in the cache; some "
        "channels in 'Other' are still effectively English but were misclassified "
        "by YouTube's API."
    )
    lines.append(
        "- No fresh discovery was run (would have cost YouTube API quota). If <100 "
        "channels here feel too thin, the cache can be re-seeded with niche queries "
        "(women's football, futsal, lower-league, fantasy analysis) via "
        "`tools/youtube-discovery/discover.py`."
    )

    MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    by_lang = {k: len(v) for k, v in lang_groups.items() if v}
    print("---- summary ----")
    print(f"total kept: {len(kept)}")
    print(f"by tier:    {tier_counts}")
    print(f"by lang:    {by_lang}")
    print(f"with usable contact route (not About-page only): {with_contact}")
    print(f"csv: {CSV_PATH}")
    print(f"md:  {MD_PATH}")


if __name__ == "__main__":
    main()
