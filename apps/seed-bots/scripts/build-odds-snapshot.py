#!/usr/bin/env python3
"""Generate apps/seed-bots/data/odds-snapshot.json from the canonical
WC 2026 fixtures plus a FIFA-ranking heuristic.

The seed-bots CLI is deterministic and ships with a frozen Polymarket-
style odds snapshot so re-runs across machines produce identical bots.
This script builds that snapshot offline; check it in alongside the
data file.

Heuristic (sufficient for cosmetic seed bots; real Polymarket pull will
replace this in Phase 2):
  - Rank table loosely derived from May 2026 FIFA Ranking + qualifying
    form. Lower rank = stronger team.
  - For group matches: convert rank gap to home/draw/away probability
    via a softmax-style mapping (logistic on rank delta).
  - For knockouts: ignore the draw bucket. Knockout slots like "1A" /
    "W73" are projected to the *predicted favourite-team-3* by walking
    the bracket cascade with the best-ranked group team in each slot.
  - Cup-winner prior: top 12 nations by ranking; mass concentrated on
    the top 4.
"""

import json
import math
import os
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIXTURES = REPO / "data" / "fifa-wc-2026" / "fixtures.json"
OUT = REPO / "apps" / "seed-bots" / "data" / "odds-snapshot.json"

# Loose FIFA-ranking heuristic. Lower index = stronger.
# Source: rough May 2026 outlook; pure heuristic so the cosmetic bots
# pick favourites that match the typical media narrative. The Tim-stated
# constraint is "no Saudi Arabia winners" and "top-6 cup winner
# concentration ~85%", both of which fall out of the cup_winner_prior
# below.
RANK = {
    "ARG": 1, "FRA": 2, "ESP": 3, "ENG": 4, "BRA": 5, "POR": 6,
    "NED": 7, "BEL": 8, "GER": 9, "ITA": 10, "CRO": 11, "URU": 12,
    "USA": 13, "COL": 14, "MEX": 15, "MAR": 16, "JPN": 17, "SUI": 18,
    "DEN": 19, "SEN": 20, "IRN": 21, "AUS": 22, "KOR": 23, "POL": 24,
    "CAN": 25, "ECU": 26, "TUN": 27, "WAL": 28, "SRB": 29, "CRC": 30,
    "GHA": 31, "CMR": 32, "NOR": 33, "EGY": 34, "TUR": 35, "AUT": 36,
    "SWE": 37, "CZE": 38, "SCO": 39, "ROU": 40, "RUS": 41, "PER": 42,
    "VEN": 43, "PAR": 44, "PAN": 45, "JAM": 46, "HND": 47, "QAT": 48,
    "BIH": 49, "RSA": 50, "GAB": 51, "NGA": 52, "ALG": 53, "CIV": 54,
    "UZB": 55, "JOR": 56, "PAR": 57, "CRC": 58, "CUW": 59,
    "NZL": 60, "SLV": 61, "GUA": 62, "HAI": 63, "SUR": 64,
    "TRI": 65, "BFA": 66, "MLI": 67, "CGO": 68, "ARM": 69,
}

# Top-12 cup-winner prior. Mass on top 3-6; spec target is top-6 ~85%.
# We list 12 nations so the validator's "top 6 >= 82%" passes with
# margin while still letting underdogs flicker through.
CUP_PRIOR = [
    ("BRA", 0.20),
    ("FRA", 0.17),
    ("ARG", 0.16),
    ("ENG", 0.13),
    ("ESP", 0.12),
    ("GER", 0.10),  # 0.88 cumulative for top-6
    ("POR", 0.05),
    ("NED", 0.03),
    ("ITA", 0.015),
    ("BEL", 0.012),
    ("URU", 0.008),
    ("USA", 0.005),
]


def softmax3(home_rank, away_rank):
    """Map (home_rank, away_rank) to (home_p, draw_p, away_p).

    Lower rank = stronger. We treat rank-delta as a logit; smaller
    home_rank gives home a higher win probability. Draw probability
    is anchored at ~24% baseline and decays as the rank gap grows.
    """
    delta = away_rank - home_rank  # positive => home is favoured
    # Logistic-ish curve: strong gap -> strong favourite.
    fav_strength = 1.0 / (1.0 + math.exp(-delta / 8.0))
    # Baseline draw probability shrinks as the gap grows.
    gap = abs(delta)
    draw_p = max(0.18, 0.32 - gap * 0.004)
    # Distribute the remaining (1 - draw_p) between home/away by
    # fav_strength.
    rem = 1.0 - draw_p
    home_p = rem * fav_strength
    away_p = rem * (1.0 - fav_strength)
    return home_p, draw_p, away_p


def rank_of(team_slot, fallback=80):
    return RANK.get(team_slot, fallback)


# ---- knockout slot projection ----
#
# Knockout fixtures reference slot codes like "1A" (group A winner),
# "2B" (group B runner-up), "W73" (winner of match 73). We project the
# strongest team in each slot by always assigning the best-ranked
# qualifier in the group, then cascading through the bracket using the
# rank-favourite heuristic for each match.

def build_knockout_projection(fixtures):
    """Return a dict mapping slot-code -> projected team3."""
    # First, identify the four teams in each group.
    group_teams = defaultdict(list)
    for f in fixtures:
        stage = f["stage"]
        if not stage.startswith("group_"):
            continue
        letter = stage.split("_")[1].upper()
        for slot in (f["home_team_slot"], f["away_team_slot"]):
            if slot not in group_teams[letter]:
                group_teams[letter].append(slot)
    # For each group, rank the four teams by their FIFA index. Best
    # rank -> 1st slot, second -> 2nd, etc.
    finishing = {}
    for letter, teams in group_teams.items():
        ranked = sorted(teams, key=rank_of)
        for i, t in enumerate(ranked, start=1):
            finishing[f"{i}{letter}"] = t

    # Third-place playoff slot codes ("3A","3B",...) -- some R32
    # fixtures use them per FIFA Annex C. Map to the third team.
    # Already handled above (i=3).

    # Now walk the knockout cascade in match order. R32 picks come
    # straight from finishing; R16 / QF / SF / final use "W<match>"
    # slot codes, which we resolve to the projected winner of that
    # match.
    projected_winner = {}  # match_number -> team3
    fixtures_by_no = {f["match_number"]: f for f in fixtures}
    # Knockout matches start at 73 (R32). Iterate in order.
    for mno in sorted(fixtures_by_no):
        f = fixtures_by_no[mno]
        stage = f["stage"]
        if stage.startswith("group_"):
            continue
        h_slot = f["home_team_slot"]
        a_slot = f["away_team_slot"]
        h_team = resolve_slot(h_slot, finishing, projected_winner)
        a_team = resolve_slot(a_slot, finishing, projected_winner)
        # Higher-ranked team wins.
        winner = h_team if rank_of(h_team) <= rank_of(a_team) else a_team
        projected_winner[mno] = winner

    # Build the slot-code -> team mapping used by odds emission.
    slot_to_team = dict(finishing)
    for mno, team in projected_winner.items():
        slot_to_team[f"W{mno}"] = team
    return slot_to_team, projected_winner


def resolve_slot(slot, finishing, projected_winner):
    if slot in finishing:
        return finishing[slot]
    if slot.startswith("W"):
        try:
            mno = int(slot[1:])
        except ValueError:
            return slot
        return projected_winner.get(mno, slot)
    return slot


# ---- emission ----

def main():
    data = json.loads(FIXTURES.read_text())
    fixtures = data["fixtures"]
    slot_to_team, projected_winner = build_knockout_projection(fixtures)

    groups = {}
    knockouts = {}
    for f in fixtures:
        mno = f["match_number"]
        stage = f["stage"]
        h_slot = f["home_team_slot"]
        a_slot = f["away_team_slot"]
        if stage.startswith("group_"):
            home_p, draw_p, away_p = softmax3(rank_of(h_slot), rank_of(a_slot))
            fav = h_slot if home_p >= away_p else a_slot
            groups[str(mno)] = {
                "home_p": round(home_p, 4),
                "draw_p": round(draw_p, 4),
                "away_p": round(away_p, 4),
                "favourite_slot": fav,
            }
        else:
            # Resolve slot to projected team for rank purposes.
            h_team = slot_to_team.get(h_slot, h_slot)
            a_team = slot_to_team.get(a_slot, a_slot)
            home_p, draw_p, away_p = softmax3(rank_of(h_team), rank_of(a_team))
            # Renormalise: knockouts have no draw bucket from the
            # perspective of the bot's pick.
            total = home_p + away_p
            home_p_norm = home_p / total
            away_p_norm = away_p / total
            # The favourite slot is the ORIGINAL slot (1A, W73, etc.)
            # that corresponds to the favoured projected team. The
            # seed-bots brackets module compares against the fixture's
            # home_team_slot / away_team_slot strings literally.
            fav = h_slot if home_p_norm >= away_p_norm else a_slot
            knockouts[str(mno)] = {
                "home_p": round(home_p_norm, 4),
                "away_p": round(away_p_norm, 4),
                "favourite_slot": fav,
            }

    cup_prior = [{"team3": t, "p": p} for (t, p) in CUP_PRIOR]
    total = sum(e["p"] for e in cup_prior)
    if abs(total - 1.0) > 0.001:
        # Normalise.
        for e in cup_prior:
            e["p"] = round(e["p"] / total, 4)

    snapshot = {
        "tournament_id": "fifa-wc-2026",
        "groups": groups,
        "knockouts": knockouts,
        "cup_winner_prior": cup_prior,
        "_meta": {
            "source": "FIFA ranking heuristic (May 2026 outlook)",
            "generated_by": "apps/seed-bots/scripts/build-odds-snapshot.py",
            "match_count": len(fixtures),
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, indent=2, sort_keys=False))
    print(f"wrote {OUT} ({len(groups)} group + {len(knockouts)} knockout entries)")


if __name__ == "__main__":
    main()
