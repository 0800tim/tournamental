"""Real-draw source adapter for the 2026 FIFA World Cup.

The placeholder shipping in `canonical_fixtures.GROUP_TEAMS_CLEAN` was
written before the Final Draw (5 December 2025, Kennedy Center,
Washington D.C.). After the draw + the March 2026 UEFA + intercontinental
play-offs all 48 slots are confirmed; this module pulls + normalises the
authoritative data so the canonical builder + the public JSON files can
be regenerated against it.

Strategy
--------
1. Try the per-group Wikipedia articles first
   (`2026_FIFA_World_Cup_Group_<letter>`). They have small, stable info-
   boxes with the team list — very low risk of structural drift.
2. Cross-check the totals against the qualification overview article
   (`2026_FIFA_World_Cup_qualification`).
3. Fall back to the manually-curated snapshot baked into this file
   (`MANUAL_DRAW_SNAPSHOT`) — sourced from the same Wikipedia revisions
   on the date in `MANUAL_SNAPSHOT_DATE`. Citation in the per-team
   ``source`` field.

The fall-back is **not synthetic** — it's the same data captured to file
so an offline rebuild produces the same teams.json + fixtures.json
without making a network call. CI uses the live path; local dev uses the
fall-back so tests are hermetic.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Manual snapshot — captured 2026-05-09 from the per-group Wikipedia articles
# (e.g. https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_A). All UEFA
# play-off finals (Bosnia, Sweden, Turkey, Czech Republic) and inter-
# confederation play-offs (DR Congo, Iraq) are resolved.
# ---------------------------------------------------------------------------

MANUAL_SNAPSHOT_DATE = "2026-05-09"
MANUAL_SNAPSHOT_SOURCE = (
    "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup "
    "(per-group articles, retrieved 2026-05-09)"
)

# Real-draw group composition. Codes are the standard FIFA tri-codes used
# elsewhere in this repo (e.g. CZE for Czech Republic, BIH for Bosnia and
# Herzegovina, COD for DR Congo, KSA for Saudi Arabia, IRQ for Iraq).
MANUAL_DRAW_SNAPSHOT: dict[str, list[str]] = {
    "A": ["MEX", "RSA", "KOR", "CZE"],
    "B": ["CAN", "BIH", "QAT", "SUI"],
    "C": ["BRA", "MAR", "HAI", "SCO"],
    "D": ["USA", "PAR", "AUS", "TUR"],
    "E": ["GER", "CUW", "CIV", "ECU"],
    "F": ["NED", "JPN", "SWE", "TUN"],
    "G": ["BEL", "EGY", "IRN", "NZL"],
    "H": ["ESP", "CPV", "KSA", "URU"],
    "I": ["FRA", "SEN", "IRQ", "NOR"],
    "J": ["ARG", "ALG", "AUT", "JOR"],
    "K": ["POR", "COD", "UZB", "COL"],
    "L": ["ENG", "CRO", "GHA", "PAN"],
}

# Mapping from canonical English country name (as it appears in the
# Wikipedia info-box) to the project's tri-code. Includes obvious
# synonyms ("Iran" / "Islamic Republic of Iran" etc.).
WIKIPEDIA_NAME_TO_CODE: dict[str, str] = {
    "Algeria": "ALG",
    "Argentina": "ARG",
    "Australia": "AUS",
    "Austria": "AUT",
    "Belgium": "BEL",
    "Bosnia and Herzegovina": "BIH",
    "Brazil": "BRA",
    "Canada": "CAN",
    "Cape Verde": "CPV",
    "Colombia": "COL",
    "Costa Rica": "CRC",
    "Croatia": "CRO",
    "Curacao": "CUW",
    "Curaçao": "CUW",
    "Czech Republic": "CZE",
    "DR Congo": "COD",
    "Democratic Republic of the Congo": "COD",
    "Denmark": "DEN",
    "Ecuador": "ECU",
    "Egypt": "EGY",
    "England": "ENG",
    "France": "FRA",
    "Germany": "GER",
    "Ghana": "GHA",
    "Haiti": "HAI",
    "Iran": "IRN",
    "Iraq": "IRQ",
    "Italy": "ITA",
    "Ivory Coast": "CIV",
    "Cote d'Ivoire": "CIV",
    "Côte d'Ivoire": "CIV",
    "Japan": "JPN",
    "Jordan": "JOR",
    "Mexico": "MEX",
    "Morocco": "MAR",
    "Netherlands": "NED",
    "New Zealand": "NZL",
    "Norway": "NOR",
    "Panama": "PAN",
    "Paraguay": "PAR",
    "Portugal": "POR",
    "Qatar": "QAT",
    "Saudi Arabia": "KSA",
    "Scotland": "SCO",
    "Senegal": "SEN",
    "South Africa": "RSA",
    "South Korea": "KOR",
    "Republic of Korea": "KOR",
    "Spain": "ESP",
    "Sweden": "SWE",
    "Switzerland": "SUI",
    "Tunisia": "TUN",
    "Turkey": "TUR",
    "Türkiye": "TUR",
    "United States": "USA",
    "Uruguay": "URU",
    "Uzbekistan": "UZB",
    "Wales": "WAL",
}


@dataclass
class DrawResult:
    """Resolved real-draw data."""

    groups: dict[str, list[str]]
    source: str
    used_fallback: bool

    def all_team_codes(self) -> list[str]:
        return [code for codes in self.groups.values() for code in codes]


def fetch_real_draw(
    client: httpx.Client | None = None,
    *,
    allow_network: bool = True,
) -> DrawResult:
    """Resolve the real 2026 FIFA WC draw from per-group Wikipedia pages.

    On any network/parsing failure we fall through to MANUAL_DRAW_SNAPSHOT
    (captured 2026-05-09). The returned DrawResult flags
    ``used_fallback=True`` in that case.
    """

    if not allow_network or client is None:
        logger.info("real-draw: using manual snapshot (allow_network=%s)", allow_network)
        return DrawResult(
            groups={k: list(v) for k, v in MANUAL_DRAW_SNAPSHOT.items()},
            source=MANUAL_SNAPSHOT_SOURCE,
            used_fallback=True,
        )

    parsed: dict[str, list[str]] = {}
    for letter in "ABCDEFGHIJKL":
        url = f"https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_{letter}"
        try:
            resp = client.get(url, timeout=30.0)
            resp.raise_for_status()
            teams = _parse_group_article(resp.text)
            if len(teams) != 4:
                raise ValueError(f"expected 4 teams in {url}, parsed {teams}")
            parsed[letter] = teams
        except Exception as exc:
            logger.warning("real-draw: %s failed (%s); using fallback", url, exc)
            return DrawResult(
                groups={k: list(v) for k, v in MANUAL_DRAW_SNAPSHOT.items()},
                source=MANUAL_SNAPSHOT_SOURCE,
                used_fallback=True,
            )

    return DrawResult(
        groups=parsed,
        source="https://en.wikipedia.org/wiki/Special:PrefixIndex/2026_FIFA_World_Cup_Group_",
        used_fallback=False,
    )


_INFOBOX_TEAM_RE = re.compile(
    r"\{\{\s*fb\|([A-Za-zÀ-ÿ' ]+)\}\}",
    re.IGNORECASE,
)


def _parse_group_article(html: str) -> list[str]:
    """Extract the four team tri-codes from a per-group Wikipedia article.

    The per-group article's lead paragraph reliably says
    "The group consists of <A>, <B>, <C>, and <D>." We pull from that
    sentence so we don't depend on info-box wikitext layout (which can
    vary). Falls back to the standings table if the sentence isn't found.
    """

    # Strategy 1: the lead-paragraph "consists of" sentence.
    m = re.search(
        r"group consists of (?P<list>[A-Z][A-Za-zÀ-ÿ' ,]+(?: and [A-Z][A-Za-zÀ-ÿ' ]+))\.",
        html,
    )
    if m:
        names = _split_oxford_list(m.group("list"))
        codes = [WIKIPEDIA_NAME_TO_CODE.get(n.strip()) for n in names]
        if all(codes) and len(codes) == 4:
            return [c for c in codes if c]

    # Strategy 2: scrape any "{{fb|<Name>}}" templates from the info-box.
    matches = _INFOBOX_TEAM_RE.findall(html)
    seen: list[str] = []
    for raw in matches:
        code = WIKIPEDIA_NAME_TO_CODE.get(raw.strip())
        if code and code not in seen:
            seen.append(code)
        if len(seen) == 4:
            break
    return seen


def _split_oxford_list(text: str) -> list[str]:
    """Split "A, B, C, and D" or "A, B and C" into ["A","B","C","D"]."""
    text = text.strip().rstrip(".")
    parts = re.split(r",\s*and\s+|\s+and\s+|,\s*", text)
    return [p.strip() for p in parts if p.strip()]


# ---------------------------------------------------------------------------
# Per-team metadata for the 10 newly-resolved teams (the 38 retained ones
# already have rows in teams.json; we keep those as-is).
# ---------------------------------------------------------------------------

NEW_TEAM_METADATA: dict[str, dict[str, Any]] = {
    "BIH": {
        "name": "Bosnia and Herzegovina",
        "short_name": "BIH",
        "confederation": "UEFA",
        "flag_emoji": "\U0001f1e7\U0001f1e6",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Bosnia_and_Herzegovina.svg",
        "kit": {"primary": "#002F6C", "secondary": "#FECB00"},
        "fifa_ranking_at_2026": 70,
        "manager": "Sergej Barbarez",
        "wikidata_q": "Q225",
        "qualified": True,
        "qualification_path": "UEFA play-offs Path A winner",
    },
    "CPV": {
        "name": "Cape Verde",
        "short_name": "CPV",
        "confederation": "CAF",
        "flag_emoji": "\U0001f1e8\U0001f1fb",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Cape_Verde.svg",
        "kit": {"primary": "#003893", "secondary": "#CF2027"},
        "fifa_ranking_at_2026": 71,
        "manager": "Bubista",
        "wikidata_q": "Q1011",
        "qualified": True,
        "qualification_path": "CAF Group D winner",
    },
    "COD": {
        "name": "DR Congo",
        "short_name": "COD",
        "confederation": "CAF",
        "flag_emoji": "\U0001f1e8\U0001f1e9",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_the_Democratic_Republic_of_the_Congo.svg",
        "kit": {"primary": "#007FFF", "secondary": "#F7D618"},
        "fifa_ranking_at_2026": 56,
        "manager": "Sébastien Desabre",
        "wikidata_q": "Q974",
        "qualified": True,
        "qualification_path": "FIFA Inter-confederation play-off (Pathway 1) winner",
    },
    "CUW": {
        "name": "Curaçao",
        "short_name": "CUW",
        "confederation": "CONCACAF",
        "flag_emoji": "\U0001f1e8\U0001f1fc",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Cura%C3%A7ao.svg",
        "kit": {"primary": "#002F6C", "secondary": "#FFCD00"},
        "fifa_ranking_at_2026": 82,
        "manager": "Dick Advocaat",
        "wikidata_q": "Q25279",
        "qualified": True,
        "qualification_path": "CONCACAF Group B winner",
    },
    "CZE": {
        "name": "Czech Republic",
        "short_name": "CZE",
        "confederation": "UEFA",
        "flag_emoji": "\U0001f1e8\U0001f1ff",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_the_Czech_Republic.svg",
        "kit": {"primary": "#11457E", "secondary": "#FFFFFF"},
        "fifa_ranking_at_2026": 41,
        "manager": "Ivan Hašek",
        "wikidata_q": "Q213",
        "qualified": True,
        "qualification_path": "UEFA play-offs Path D winner",
    },
    "ESP": {
        "name": "Spain",
        "short_name": "ESP",
        "confederation": "UEFA",
        "flag_emoji": "\U0001f1ea\U0001f1f8",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Spain.svg",
        "kit": {"primary": "#AA151B", "secondary": "#F1BF00"},
        "fifa_ranking_at_2026": 3,
        "manager": "Luis de la Fuente",
        "wikidata_q": "Q29",
        "qualified": True,
        "qualification_path": "UEFA Group E winner",
    },
    "HAI": {
        "name": "Haiti",
        "short_name": "HAI",
        "confederation": "CONCACAF",
        "flag_emoji": "\U0001f1ed\U0001f1f9",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Haiti.svg",
        "kit": {"primary": "#00209F", "secondary": "#D21034"},
        "fifa_ranking_at_2026": 83,
        "manager": "Sébastien Migné",
        "wikidata_q": "Q790",
        "qualified": True,
        "qualification_path": "CONCACAF Group C winner",
    },
    "IRQ": {
        "name": "Iraq",
        "short_name": "IRQ",
        "confederation": "AFC",
        "flag_emoji": "\U0001f1ee\U0001f1f6",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Iraq.svg",
        "kit": {"primary": "#007A3D", "secondary": "#FFFFFF"},
        "fifa_ranking_at_2026": 58,
        "manager": "Graham Arnold",
        "wikidata_q": "Q796",
        "qualified": True,
        "qualification_path": "FIFA Inter-confederation play-off (Pathway 2) winner",
    },
    "KSA": {
        "name": "Saudi Arabia",
        "short_name": "KSA",
        "confederation": "AFC",
        "flag_emoji": "\U0001f1f8\U0001f1e6",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Saudi_Arabia.svg",
        "kit": {"primary": "#006C35", "secondary": "#FFFFFF"},
        "fifa_ranking_at_2026": 59,
        "manager": "Hervé Renard",
        "wikidata_q": "Q851",
        "qualified": True,
        "qualification_path": "AFC fourth round Group B winner",
    },
    "SWE": {
        "name": "Sweden",
        "short_name": "SWE",
        "confederation": "UEFA",
        "flag_emoji": "\U0001f1f8\U0001f1ea",
        "flag_svg_url": "https://commons.wikimedia.org/wiki/Special:FilePath/Flag_of_Sweden.svg",
        "kit": {"primary": "#006AA7", "secondary": "#FECC00"},
        "fifa_ranking_at_2026": 33,
        "manager": "Graham Potter",
        "wikidata_q": "Q34",
        "qualified": True,
        "qualification_path": "UEFA play-offs Path B winner",
    },
}


# Codes from the pre-draw teams.json that are no longer in the tournament
# after the real draw + March 2026 play-offs resolved.
DROPPED_TEAM_CODES: tuple[str, ...] = (
    "CRC",
    "DEN",
    "ITA",
    "WAL",
    "IPO1",
    "IPO2",
    "UPO1",
    "UPO2",
    "UPO3",
    "UPO4",
)
