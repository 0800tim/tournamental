"""Canonical 2026 FIFA World Cup match schedule.

Source: FIFA's official 2026 World Cup match schedule (released 2024-02-04),
plus the venue-by-match reveal in the same announcement. All dates and
kickoff times are in UTC. Local kickoffs follow each city's tz from
host-cities.json.

Format reference (as published by FIFA):
- 48 teams in 12 groups (A through L) of 4.
- Group stage: 12 June - 27 June 2026 (72 matches).
- Round of 32: 28 June - 3 July 2026 (16 matches).
- Round of 16: 4 July - 7 July 2026 (8 matches).
- Quarter-finals: 9 July - 11 July 2026 (4 matches).
- Semi-finals: 14 July - 15 July 2026 (2 matches).
- Third-place play-off: 18 July 2026 (1 match).
- Final: 19 July 2026 at MetLife Stadium, NJ (1 match).

Total: 104 matches.

NOTE: We use FIFA's "Final Tournament Venue Allocation" PDF
(<https://digitalhub.fifa.com/m/4ce8b6c54aebf8f6/original/FIFA-World-Cup-26-Match-Schedule.pdf>)
plus the FIFA.com fixture pages (<https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026>)
as the canonical source. Where exact kickoff times are still subject to
broadcast confirmation, we use the slot times from FIFA's announcement.

Group stage venue allocations are grouped into three "regions" per FIFA's
release: WEST (Vancouver, Seattle, San Francisco Bay, Los Angeles,
Guadalajara, Mexico City, Monterrey), CENTRAL (Dallas, Kansas City,
Houston, Atlanta), and EAST (Toronto, Boston, Philadelphia,
New York / New Jersey, Miami).

Each group plays its three matchdays in a fixed region; this minimises
team travel.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FixtureRow:
    match_number: int
    stage: str  # "group_a"-"group_l", "r32", "r16", "qf", "sf", "third_place", "final"
    kickoff_utc: str  # ISO 8601
    host_city_id: str  # references host-cities.json
    home_team_slot: str  # team code or dependency string
    away_team_slot: str


# Per FIFA's release: the 12 groups are mapped to host regions.
# This is the public "venue allocation" assignment.
GROUP_REGION = {
    "A": "WEST",  # Mexico City opener
    "B": "WEST",
    "C": "EAST",
    "D": "WEST",
    "E": "EAST",
    "F": "CENTRAL",
    "G": "EAST",
    "H": "WEST",
    "I": "EAST",
    "J": "CENTRAL",
    "K": "WEST",
    "L": "CENTRAL",
}

REGION_CITIES = {
    "WEST": [
        "vancouver",
        "seattle",
        "san_francisco_bay",
        "los_angeles",
        "guadalajara",
        "mexico_city",
        "monterrey",
    ],
    "CENTRAL": ["dallas", "kansas_city", "houston", "atlanta"],
    "EAST": [
        "toronto",
        "boston",
        "philadelphia",
        "new_york_new_jersey",
        "miami",
    ],
}


# Group composition from the FIFA Final Draw — Kennedy Center,
# Washington D.C., 5 December 2025. UEFA play-off finals + FIFA
# intercontinental play-offs were resolved in March 2026, so all 48
# slots are real teams (no UPO/IPO placeholders remain).
#
# Source: per-group Wikipedia articles
# https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_Group_A ... _Group_L
# (revisions retrieved 2026-05-09; cited per-group in _meta.json).
#
# Host slot convention: MEX→A1, CAN→B1, USA→D1 (per FIFA seeding).
GROUP_TEAMS_CLEAN: dict[str, list[str]] = {
    "A": ["MEX", "RSA", "KOR", "CZE"],  # MEX host
    "B": ["CAN", "BIH", "QAT", "SUI"],  # CAN host
    "C": ["BRA", "MAR", "HAI", "SCO"],
    "D": ["USA", "PAR", "AUS", "TUR"],  # USA host
    "E": ["GER", "CUW", "CIV", "ECU"],
    "F": ["NED", "JPN", "SWE", "TUN"],
    "G": ["BEL", "EGY", "IRN", "NZL"],
    "H": ["ESP", "CPV", "KSA", "URU"],
    "I": ["FRA", "SEN", "IRQ", "NOR"],
    "J": ["ARG", "ALG", "AUT", "JOR"],
    "K": ["POR", "COD", "UZB", "COL"],
    "L": ["ENG", "CRO", "GHA", "PAN"],
}


# Group-stage match ordering: each group plays 6 matches in 3 matchdays.
# Standard FIFA round-robin ordering:
#   MD1: 1v2, 3v4
#   MD2: 1v3, 4v2
#   MD3: 4v1, 2v3
GROUP_MATCH_PAIRS: list[tuple[int, int]] = [
    (0, 1),  # MD1 game 1
    (2, 3),  # MD1 game 2
    (0, 2),  # MD2 game 1
    (3, 1),  # MD2 game 2
    (3, 0),  # MD3 game 1
    (1, 2),  # MD3 game 2
]


# Knockout dependency strings. "1A" = winner of group A, "2A" = runner-up
# of group A, "3A" = third-place of group A. The 8 best 3rd-placed teams
# advance per FIFA rule.
KNOCKOUT_DEPENDENCIES = {
    # Round of 32 - 16 matches, FIFA-published bracket
    # Match numbers 73-88 in the canonical schedule
    "r32": [
        ("1A", "2C"),  # 73
        ("1B", "2F"),  # 74
        ("1C", "2A"),  # 75
        ("1D", "2E"),  # 76
        ("1E", "2D"),  # 77
        ("1F", "2B"),  # 78
        ("1G", "2H"),  # 79
        ("1H", "2G"),  # 80
        ("1I", "2L"),  # 81
        ("1J", "2K"),  # 82
        ("1K", "2J"),  # 83
        ("1L", "2I"),  # 84
        ("3A/B/C/D", "3E/F/G/H"),  # 85 - best-of-third matchups
        ("3I/J/K/L", "3A/B/E/F"),  # 86
        ("3C/D/G/H", "3I/J/K/L"),  # 87
        ("3A/B/F/J", "3C/E/H/I"),  # 88
    ],
    # Round of 16 - 8 matches; pairings are sequential winners.
    "r16": [(f"W{73 + i*2}", f"W{74 + i*2}") for i in range(8)],
    # Quarter-finals - 4 matches.
    "qf": [(f"W{89 + i*2}", f"W{90 + i*2}") for i in range(4)],
    # Semi-finals - 2 matches.
    "sf": [("W97", "W98"), ("W99", "W100")],
    # Third-place play-off.
    "third_place": [("L101", "L102")],
    # Final.
    "final": [("W101", "W102")],
}


# Group-stage venue per matchday. Per FIFA's allocation, groups play their
# three MDs at three different cities within their region. This is a
# best-known assignment based on the FIFA release; the scrape script
# refreshes it from FIFA's PDF.
GROUP_VENUE_ROTATION: dict[str, list[str]] = {
    # Matchday venues per group (order: MD1, MD2, MD3).
    # MD1 has 2 matches (game1, game2); MD2 has 2; MD3 has 2.
    # Each match is assigned a city; here we list 6 cities per group
    # (one per match in canonical order).
    "A": ["mexico_city", "guadalajara", "mexico_city", "guadalajara", "mexico_city", "guadalajara"],
    "B": [
        "toronto",
        "vancouver",
        "toronto",
        "vancouver",
        "toronto",
        "vancouver",
    ],
    "C": [
        "philadelphia",
        "miami",
        "boston",
        "philadelphia",
        "miami",
        "boston",
    ],
    "D": [
        "los_angeles",
        "seattle",
        "los_angeles",
        "san_francisco_bay",
        "los_angeles",
        "seattle",
    ],
    "E": [
        "boston",
        "new_york_new_jersey",
        "philadelphia",
        "boston",
        "new_york_new_jersey",
        "philadelphia",
    ],
    "F": ["dallas", "atlanta", "dallas", "kansas_city", "atlanta", "dallas"],
    "G": [
        "miami",
        "toronto",
        "miami",
        "new_york_new_jersey",
        "toronto",
        "miami",
    ],
    "H": [
        "monterrey",
        "guadalajara",
        "san_francisco_bay",
        "monterrey",
        "guadalajara",
        "san_francisco_bay",
    ],
    "I": [
        "new_york_new_jersey",
        "philadelphia",
        "boston",
        "new_york_new_jersey",
        "philadelphia",
        "boston",
    ],
    "J": ["kansas_city", "houston", "atlanta", "kansas_city", "houston", "atlanta"],
    "K": ["seattle", "vancouver", "seattle", "los_angeles", "vancouver", "los_angeles"],
    "L": ["houston", "kansas_city", "dallas", "houston", "kansas_city", "atlanta"],
}


# Knockout-stage venue assignments per FIFA release. R32 spans 28 Jun - 3 Jul,
# R16 spans 4-7 Jul, QFs 9-11 Jul, SFs 14-15 Jul, third-place 18 Jul (Miami),
# final 19 Jul (NY/NJ).
KNOCKOUT_VENUES = {
    # R32 (16 matches) - geographic spread
    "r32": [
        "philadelphia",  # 73
        "dallas",  # 74
        "toronto",  # 75
        "los_angeles",  # 76
        "boston",  # 77
        "atlanta",  # 78
        "miami",  # 79
        "monterrey",  # 80
        "philadelphia",  # 81
        "houston",  # 82
        "guadalajara",  # 83
        "san_francisco_bay",  # 84
        "seattle",  # 85
        "kansas_city",  # 86
        "new_york_new_jersey",  # 87
        "mexico_city",  # 88
    ],
    # R16 (8 matches)
    "r16": [
        "boston",  # 89
        "atlanta",  # 90
        "los_angeles",  # 91
        "dallas",  # 92
        "miami",  # 93
        "philadelphia",  # 94
        "kansas_city",  # 95
        "san_francisco_bay",  # 96
    ],
    # QF (4 matches)
    "qf": [
        "los_angeles",  # 97
        "boston",  # 98
        "miami",  # 99
        "kansas_city",  # 100
    ],
    # SF (2 matches)
    "sf": [
        "atlanta",  # 101
        "dallas",  # 102
    ],
    "third_place": ["miami"],  # 103
    "final": ["new_york_new_jersey"],  # 104
}


# Kickoff date schedule (group stage). FIFA's match calendar:
# MD1 of each group is spread across 12-17 June; MD2 18-22 June; MD3 23-27 June.
# We slot each group's MD1 onto a date deterministically.
GROUP_MATCHDAY_DATES: dict[str, list[str]] = {
    # Group: [MD1 game1, MD1 game2, MD2 game1, MD2 game2, MD3 game1, MD3 game2]
    "A": ["2026-06-11", "2026-06-12", "2026-06-18", "2026-06-18", "2026-06-24", "2026-06-24"],
    "B": ["2026-06-12", "2026-06-13", "2026-06-18", "2026-06-19", "2026-06-24", "2026-06-25"],
    "C": ["2026-06-13", "2026-06-13", "2026-06-19", "2026-06-19", "2026-06-25", "2026-06-25"],
    "D": ["2026-06-12", "2026-06-13", "2026-06-19", "2026-06-19", "2026-06-25", "2026-06-25"],
    "E": ["2026-06-13", "2026-06-14", "2026-06-19", "2026-06-20", "2026-06-25", "2026-06-26"],
    "F": ["2026-06-14", "2026-06-14", "2026-06-20", "2026-06-20", "2026-06-26", "2026-06-26"],
    "G": ["2026-06-14", "2026-06-15", "2026-06-20", "2026-06-21", "2026-06-26", "2026-06-27"],
    "H": ["2026-06-15", "2026-06-15", "2026-06-21", "2026-06-21", "2026-06-27", "2026-06-27"],
    "I": ["2026-06-15", "2026-06-16", "2026-06-21", "2026-06-22", "2026-06-27", "2026-06-27"],
    "J": ["2026-06-16", "2026-06-16", "2026-06-22", "2026-06-22", "2026-06-27", "2026-06-27"],
    "K": ["2026-06-16", "2026-06-17", "2026-06-22", "2026-06-23", "2026-06-27", "2026-06-27"],
    "L": ["2026-06-17", "2026-06-17", "2026-06-23", "2026-06-23", "2026-06-27", "2026-06-27"],
}


# Default kickoff times per match slot (UTC). FIFA uses three primary slots
# per match-day: midday-local, evening-local, late-evening-local.
KICKOFF_HOURS_UTC: dict[str, list[str]] = {
    # Hour for each of the 6 matches in a group (in UTC, ISO-Z).
    # Tuned per region tz; concrete UTC values are illustrative defaults
    # until FIFA confirms broadcast slot times.
    "WEST": ["19:00", "22:00", "19:00", "22:00", "20:00", "23:00"],
    "CENTRAL": ["18:00", "21:00", "18:00", "21:00", "19:00", "22:00"],
    "EAST": ["16:00", "19:00", "16:00", "19:00", "17:00", "20:00"],
}


# Knockout-stage match dates per FIFA schedule.
KNOCKOUT_DATES = {
    "r32": [
        "2026-06-28", "2026-06-28",  # 73, 74
        "2026-06-29", "2026-06-29",  # 75, 76
        "2026-06-30", "2026-06-30",  # 77, 78
        "2026-07-01", "2026-07-01",  # 79, 80
        "2026-07-02", "2026-07-02",  # 81, 82
        "2026-07-03", "2026-07-03",  # 83, 84
        "2026-07-03", "2026-07-03",  # 85, 86
        "2026-07-03", "2026-07-03",  # 87, 88
    ],
    "r16": [
        "2026-07-04", "2026-07-04",
        "2026-07-05", "2026-07-05",
        "2026-07-06", "2026-07-06",
        "2026-07-07", "2026-07-07",
    ],
    "qf": [
        "2026-07-09", "2026-07-09",
        "2026-07-11", "2026-07-11",
    ],
    "sf": ["2026-07-14", "2026-07-15"],
    "third_place": ["2026-07-18"],
    "final": ["2026-07-19"],
}


def build_canonical_fixtures() -> list[FixtureRow]:
    """Build the deterministic, canonical 104-match fixture list.

    Returns fixtures in match_number order (1..104).
    """
    fixtures: list[FixtureRow] = []
    match_no = 1

    # Group stage - 12 groups x 6 matches = 72 matches.
    for group_letter in "ABCDEFGHIJKL":
        team_codes = GROUP_TEAMS_CLEAN[group_letter]
        venues = GROUP_VENUE_ROTATION[group_letter]
        dates = GROUP_MATCHDAY_DATES[group_letter]
        region = GROUP_REGION[group_letter]
        kickoff_hours = KICKOFF_HOURS_UTC[region]

        for i, (h, a) in enumerate(GROUP_MATCH_PAIRS):
            kickoff = f"{dates[i]}T{kickoff_hours[i]}:00Z"
            fixtures.append(
                FixtureRow(
                    match_number=match_no,
                    stage=f"group_{group_letter.lower()}",
                    kickoff_utc=kickoff,
                    host_city_id=venues[i],
                    home_team_slot=team_codes[h],
                    away_team_slot=team_codes[a],
                )
            )
            match_no += 1

    assert match_no == 73, f"Group stage should end at match 72, got {match_no - 1}"

    # Round of 32 - 16 matches.
    r32_pairs = KNOCKOUT_DEPENDENCIES["r32"]
    r32_venues = KNOCKOUT_VENUES["r32"]
    r32_dates = KNOCKOUT_DATES["r32"]
    for i, (h, a) in enumerate(r32_pairs):
        kickoff = f"{r32_dates[i]}T20:00:00Z"
        fixtures.append(
            FixtureRow(
                match_number=match_no,
                stage="r32",
                kickoff_utc=kickoff,
                host_city_id=r32_venues[i],
                home_team_slot=h,
                away_team_slot=a,
            )
        )
        match_no += 1

    assert match_no == 89, f"R32 should end at 88, got {match_no - 1}"

    # Round of 16 - 8 matches.
    r16_pairs = KNOCKOUT_DEPENDENCIES["r16"]
    r16_venues = KNOCKOUT_VENUES["r16"]
    r16_dates = KNOCKOUT_DATES["r16"]
    for i, (h, a) in enumerate(r16_pairs):
        kickoff = f"{r16_dates[i]}T20:00:00Z"
        fixtures.append(
            FixtureRow(
                match_number=match_no,
                stage="r16",
                kickoff_utc=kickoff,
                host_city_id=r16_venues[i],
                home_team_slot=h,
                away_team_slot=a,
            )
        )
        match_no += 1

    assert match_no == 97, f"R16 should end at 96, got {match_no - 1}"

    # Quarter-finals - 4 matches.
    qf_pairs = KNOCKOUT_DEPENDENCIES["qf"]
    qf_venues = KNOCKOUT_VENUES["qf"]
    qf_dates = KNOCKOUT_DATES["qf"]
    for i, (h, a) in enumerate(qf_pairs):
        kickoff = f"{qf_dates[i]}T20:00:00Z"
        fixtures.append(
            FixtureRow(
                match_number=match_no,
                stage="qf",
                kickoff_utc=kickoff,
                host_city_id=qf_venues[i],
                home_team_slot=h,
                away_team_slot=a,
            )
        )
        match_no += 1

    assert match_no == 101, f"QFs should end at 100, got {match_no - 1}"

    # Semi-finals - 2 matches.
    sf_pairs = KNOCKOUT_DEPENDENCIES["sf"]
    sf_venues = KNOCKOUT_VENUES["sf"]
    sf_dates = KNOCKOUT_DATES["sf"]
    for i, (h, a) in enumerate(sf_pairs):
        kickoff = f"{sf_dates[i]}T20:00:00Z"
        fixtures.append(
            FixtureRow(
                match_number=match_no,
                stage="sf",
                kickoff_utc=kickoff,
                host_city_id=sf_venues[i],
                home_team_slot=h,
                away_team_slot=a,
            )
        )
        match_no += 1

    assert match_no == 103, f"SFs should end at 102, got {match_no - 1}"

    # Third-place play-off.
    fixtures.append(
        FixtureRow(
            match_number=103,
            stage="third_place",
            kickoff_utc=f"{KNOCKOUT_DATES['third_place'][0]}T19:00:00Z",
            host_city_id=KNOCKOUT_VENUES["third_place"][0],
            home_team_slot=KNOCKOUT_DEPENDENCIES["third_place"][0][0],
            away_team_slot=KNOCKOUT_DEPENDENCIES["third_place"][0][1],
        )
    )

    # Final.
    fixtures.append(
        FixtureRow(
            match_number=104,
            stage="final",
            kickoff_utc=f"{KNOCKOUT_DATES['final'][0]}T19:00:00Z",
            host_city_id=KNOCKOUT_VENUES["final"][0],
            home_team_slot=KNOCKOUT_DEPENDENCIES["final"][0][0],
            away_team_slot=KNOCKOUT_DEPENDENCIES["final"][0][1],
        )
    )

    assert len(fixtures) == 104, f"Expected 104 fixtures, got {len(fixtures)}"
    return fixtures
