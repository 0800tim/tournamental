#!/usr/bin/env bash
#
# results-poller.sh
#
# Polls ESPN's public FIFA World Cup scoreboard JSON feed for any
# finished matches and POSTs their result to our game-service admin
# endpoint. Designed to run from cron once per minute. Idempotent: if
# a result is already recorded the server upsert is harmless, but we
# still skip the POST to avoid invalidating the leaderboard cache
# every minute.
#
# Why ESPN: no API key required, served from site.api.espn.com, used
# by espn.com itself for live updates. Team abbreviations match the
# FIFA codes we use everywhere (MEX, RSA, KOR, CZE, etc.), so the
# match -> our match_no lookup is a clean tuple match.
#
# Cron entry (one-shot, install once):
#   * * * * * /home/clawdbot/clawdia/projects/vtorn/infra/scripts/results-poller.sh >/dev/null 2>&1
#
# To install:
#   ( crontab -l 2>/dev/null;
#     echo "* * * * * /home/clawdbot/clawdia/projects/vtorn/infra/scripts/results-poller.sh >/dev/null 2>&1"
#   ) | crontab -
#
# Born from the WC 2026 incident (Tim 2026-06-12) where match 1's
# result was hand-recorded ~15 min after FT and match 2's result was
# only recorded ~2h after FT because there was no automation. Target
# latency from final whistle to DB write: ≤ 5 minutes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FIXTURES_PATH="${FIXTURES_PATH:-$REPO_ROOT/packages/bracket-engine/data/fifa-wc-2026-fixtures.json}"
GAME_DB="${GAME_DB:-$REPO_ROOT/apps/game/data/game.db}"
GAME_BASE="${GAME_BASE:-https://game.tournamental.com}"
TOURNAMENT_ID="${TOURNAMENT_ID:-fifa-wc-2026}"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
mkdir -p "$LOG_DIR"

# Pull the admin token from the game .env so we don't checkin secrets.
if [[ -z "${GAME_ADMIN_TOKEN:-}" ]]; then
  if [[ -f "$REPO_ROOT/apps/game/.env.production" ]]; then
    # shellcheck disable=SC1091
    set -a; . "$REPO_ROOT/apps/game/.env.production"; set +a
  fi
fi
if [[ -z "${GAME_ADMIN_TOKEN:-}" ]]; then
  echo "$(date -u +%FT%TZ) FATAL: GAME_ADMIN_TOKEN not set" >&2
  exit 2
fi

# Hand off to Python — JSON gymnastics + sqlite + UTC date math are all
# cleaner there. Pass everything the python step needs via env so the
# script body is self-contained and shellcheck-clean.
export FIXTURES_PATH GAME_DB GAME_BASE TOURNAMENT_ID LOG_DIR GAME_ADMIN_TOKEN

python3 - <<'PY'
import json, os, sqlite3, sys, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

FIXTURES = os.environ["FIXTURES_PATH"]
GAME_DB = os.environ["GAME_DB"]
BASE = os.environ["GAME_BASE"]
TID = os.environ["TOURNAMENT_ID"]
LOG_DIR = os.environ["LOG_DIR"]
TOKEN = os.environ["GAME_ADMIN_TOKEN"]

UTC = timezone.utc
now = datetime.now(tz=UTC)
log_path = os.path.join(LOG_DIR, "results-poller.log")

def log(msg):
    line = f"{now.strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}"
    print(line)
    with open(log_path, "a") as f:
        f.write(line + "\n")

# ── 1. Which fixtures might have just finished? ───────────────────
# We look at any fixture whose kickoff was at most KO_WINDOW_HOURS
# ago, capped at MAX_LOOKBACK_HOURS so we don't replay history every
# minute. The window covers 90' + ET + pens + injury time + buffer.
KO_WINDOW_HOURS = 4
MAX_LOOKBACK_HOURS = 24

window_start = now - timedelta(hours=MAX_LOOKBACK_HOURS)
ko_window = now - timedelta(hours=KO_WINDOW_HOURS)

with open(FIXTURES) as f:
    fx = json.load(f)

# Build (home_code, away_code) -> match_no (group stage only; we don't
# have team codes for knockouts until the cascade resolves).
groups = {g["id"]: g["team_ids"] for g in fx["groups"]}
fixtures = []  # list of dicts with match_no, kickoff_dt, home, away, stage
for m in fx["group_fixtures"]:
    teams = groups[m["group_id"]]
    home = teams[m["home_idx"]]
    away = teams[m["away_idx"]]
    ko_dt = datetime.fromisoformat(m["kickoff_utc"].replace("Z", "+00:00"))
    if window_start <= ko_dt <= now:
        fixtures.append({
            "match_no": m["match_no"], "home": home, "away": away,
            "kickoff": ko_dt, "stage": "group",
        })

if not fixtures:
    log("no fixtures in window — exiting silently")
    sys.exit(0)

# ── 2. Filter out fixtures whose result is already recorded. ──────
con = sqlite3.connect(GAME_DB)
con.row_factory = sqlite3.Row
recorded = set()
try:
    for row in con.execute(
        "SELECT match_id FROM match_results WHERE tournament_id=?", (TID,)
    ):
        recorded.add(str(row["match_id"]))
finally:
    con.close()

pending = [f for f in fixtures if str(f["match_no"]) not in recorded]
if not pending:
    log(f"all {len(fixtures)} candidate fixtures already recorded")
    sys.exit(0)

# ── 3. Fetch ESPN scoreboard for each kickoff UTC date AND the day
# before AND the day after. ESPN buckets events under the US
# broadcast date (EDT/EST) which can be the day before our UTC
# kickoff for matches that start in the early UTC hours (e.g. m19
# kicked off at 01:00 UTC June 13; ESPN files it under 20260612).
# Probe a 3-day window so we never miss the event again.
# Tim 2026-06-13: this was the bug that left match 19 unrecorded for
# ~10 min after FT.
def date_window(kickoff):
    d0 = kickoff.strftime("%Y%m%d")
    d_minus_1 = (kickoff - timedelta(days=1)).strftime("%Y%m%d")
    d_plus_1  = (kickoff + timedelta(days=1)).strftime("%Y%m%d")
    return [d_minus_1, d0, d_plus_1]

dates_set = set()
for f in pending:
    dates_set.update(date_window(f["kickoff"]))
dates = sorted(dates_set)
log(f"polling ESPN for dates={dates}, pending={[f['match_no'] for f in pending]}")

def fetch_espn(date_yyyymmdd):
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates={date_yyyymmdd}"
    req = urllib.request.Request(url, headers={"User-Agent": "vtorn-results-poller/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as ex:
        log(f"WARN ESPN fetch failed for {date_yyyymmdd}: {ex}")
        return None

# Build a lookup keyed by (home_code, away_code) → ESPN event so we
# can resolve each pending fixture cleanly.
espn_by_pair = {}
for d in dates:
    data = fetch_espn(d)
    if not data:
        continue
    for e in data.get("events", []):
        comp = (e.get("competitions") or [{}])[0]
        cs = comp.get("competitors") or []
        home = next((c for c in cs if c.get("homeAway") == "home"), None)
        away = next((c for c in cs if c.get("homeAway") == "away"), None)
        if not home or not away:
            continue
        h_code = (home.get("team") or {}).get("abbreviation", "").upper()
        a_code = (away.get("team") or {}).get("abbreviation", "").upper()
        state = ((comp.get("status") or {}).get("type") or {}).get("state")
        name = ((comp.get("status") or {}).get("type") or {}).get("name")
        try:
            h_score = int(home.get("score", "")) if home.get("score") not in (None, "") else None
            a_score = int(away.get("score", "")) if away.get("score") not in (None, "") else None
        except (TypeError, ValueError):
            h_score, a_score = None, None
        espn_by_pair[(h_code, a_code)] = {
            "state": state, "name": name,
            "home_score": h_score, "away_score": a_score,
        }

# ── 4. For each pending fixture, post the result if it's final. ────
posted = 0
for f in pending:
    key = (f["home"], f["away"])
    entry = espn_by_pair.get(key) or espn_by_pair.get((f["away"], f["home"]))
    if not entry:
        log(f"  m{f['match_no']} {f['home']}v{f['away']}: ESPN has no event yet")
        continue
    # ESPN status codes we treat as final: STATUS_FULL_TIME, STATUS_FINAL,
    # STATUS_END_OF_REGULATION, STATUS_AFTER_EXTRA_TIME,
    # STATUS_FINAL_AET, STATUS_FINAL_PEN
    name = (entry.get("name") or "").upper()
    state = (entry.get("state") or "").lower()
    is_final = state == "post" and (
        "FULL_TIME" in name or "FINAL" in name or "END_OF_REGULATION" in name
        or "AET" in name or "AFTER_EXTRA_TIME" in name or "_PEN" in name
    )
    if not is_final:
        log(f"  m{f['match_no']} {f['home']}v{f['away']}: ESPN state={state} name={name} (not final yet)")
        continue
    h, a = entry["home_score"], entry["away_score"]
    if h is None or a is None:
        log(f"  m{f['match_no']} {f['home']}v{f['away']}: final but missing scores, skipping")
        continue
    outcome = "home_win" if h > a else "away_win" if a > h else "draw"
    winner = f["home"] if outcome == "home_win" else f["away"] if outcome == "away_win" else None

    body = json.dumps({
        "tournament_id": TID,
        "outcome": outcome,
        "homeScore": h,
        "awayScore": a,
        "winner": winner,
        "stage": "group",
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/v1/match/{f['match_no']}/result",
        data=body, method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.load(r)
        posted += 1
        log(f"  m{f['match_no']} {f['home']} {h}-{a} {f['away']} outcome={outcome} rescored={resp.get('rescored_brackets')}")
    except urllib.error.HTTPError as ex:
        log(f"  m{f['match_no']} POST failed: HTTP {ex.code} {ex.reason}")
    except urllib.error.URLError as ex:
        log(f"  m{f['match_no']} POST failed: {ex}")

if posted:
    log(f"posted {posted} new result(s)")
else:
    log("no new finals this tick")
PY
