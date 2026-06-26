#!/usr/bin/env bash
#
# results-poller.sh
#
# Polls ESPN's public FIFA World Cup scoreboard JSON feed for any
# finished matches and POSTs their result to our game-service admin
# endpoint. Designed to run from cron once per minute. Idempotent: if
# a result is already recorded we skip the POST to avoid invalidating
# the leaderboard cache every minute.
#
# Group stage: matched to our fixtures by (home_code, away_code) team
# pair — ESPN abbreviations equal our FIFA codes.
#
# Knockouts (R32 -> Final): the fixtures hold placeholder slots (2A,
# W89, best-3rd...) so we can't match by team code pre-game. Instead we
# match each knockout fixture to its ESPN event by SCHEDULE (kickoff
# time within a few hours + venue), then record the ACTUAL teams + the
# ESPN-flagged winner. Results are keyed by the knockout id (eg
# "r32_01") — the same key knockout PICKS use — so scoring lines up and
# the bracket cascade can advance the real winner into the next round.
# Tim 2026-06-26.
#
# Cron entry (one-shot, install once):
#   * * * * * /home/clawdbot/clawdia/projects/vtorn/infra/scripts/results-poller.sh >/dev/null 2>&1
#
# Env knobs:
#   GAME_BASE        game-service base URL (default prod)
#   DRY_RUN=1        log what would be POSTed, don't POST (dev testing)
#
# Born from the WC 2026 incident (Tim 2026-06-12) where match results
# were hand-recorded long after FT. Target latency FT -> DB: <= 5 min.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FIXTURES_PATH="${FIXTURES_PATH:-$REPO_ROOT/packages/bracket-engine/data/fifa-wc-2026-fixtures.json}"
GAME_DB="${GAME_DB:-$REPO_ROOT/apps/game/data/game.db}"
GAME_BASE="${GAME_BASE:-https://game.tournamental.com}"
TOURNAMENT_ID="${TOURNAMENT_ID:-fifa-wc-2026}"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
DRY_RUN="${DRY_RUN:-}"
# Knockout recording is OFF by default so the live cron's behaviour stays
# identical (group-stage only) until we explicitly switch it on. Set
# KO_RECORDING=1 (in the cron env) to start recording R32+ results. Tim
# 2026-06-26.
KO_RECORDING="${KO_RECORDING:-}"
mkdir -p "$LOG_DIR"

# Pull the admin token from the game .env so we don't checkin secrets.
# In DRY_RUN we never POST, so a token isn't required.
if [[ -z "${GAME_ADMIN_TOKEN:-}" ]]; then
  if [[ -f "$REPO_ROOT/apps/game/.env.production" ]]; then
    # shellcheck disable=SC1091
    set -a; . "$REPO_ROOT/apps/game/.env.production"; set +a
  fi
fi
if [[ -z "${GAME_ADMIN_TOKEN:-}" ]]; then
  if [[ -n "$DRY_RUN" && "$DRY_RUN" != "0" ]]; then
    GAME_ADMIN_TOKEN="dry-run-no-token"
  else
    echo "$(date -u +%FT%TZ) FATAL: GAME_ADMIN_TOKEN not set" >&2
    exit 2
  fi
fi

export FIXTURES_PATH GAME_DB GAME_BASE TOURNAMENT_ID LOG_DIR GAME_ADMIN_TOKEN DRY_RUN KO_RECORDING

python3 - <<'PY'
import json, os, sqlite3, sys, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone

FIXTURES = os.environ["FIXTURES_PATH"]
GAME_DB = os.environ["GAME_DB"]
BASE = os.environ["GAME_BASE"]
TID = os.environ["TOURNAMENT_ID"]
LOG_DIR = os.environ["LOG_DIR"]
TOKEN = os.environ["GAME_ADMIN_TOKEN"]
DRY_RUN = os.environ.get("DRY_RUN", "") not in ("", "0", "false", "False")
KO_RECORDING = os.environ.get("KO_RECORDING", "") not in ("", "0", "false", "False")

UTC = timezone.utc
now = datetime.now(tz=UTC)
log_path = os.path.join(LOG_DIR, "results-poller.log")

def log(msg):
    line = f"{now.strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}"
    print(line)
    with open(log_path, "a") as f:
        f.write(line + "\n")

# ── 1. Which fixtures might have just finished? ───────────────────
# Any fixture whose kickoff was at most KO_WINDOW_HOURS ago (knockouts
# run longer with ET + pens), capped at MAX_LOOKBACK_HOURS so we don't
# replay history every minute.
MAX_LOOKBACK_HOURS = 24
window_start = now - timedelta(hours=MAX_LOOKBACK_HOURS)

with open(FIXTURES) as f:
    fx = json.load(f)

groups = {g["id"]: g["team_ids"] for g in fx["groups"]}
fixtures = []  # mixed list of group + knockout fixtures in window

# Group fixtures: teams known, post_id = bare match number.
for m in fx["group_fixtures"]:
    teams = groups[m["group_id"]]
    ko_dt = datetime.fromisoformat(m["kickoff_utc"].replace("Z", "+00:00"))
    if window_start <= ko_dt <= now:
        fixtures.append({
            "kind": "group", "post_id": str(m["match_no"]), "match_no": m["match_no"],
            "home": teams[m["home_idx"]], "away": teams[m["away_idx"]],
            "kickoff": ko_dt, "venue": m.get("venue"), "stage": "group",
        })

# Knockout fixtures: teams unknown pre-game, post_id = knockout id.
# Gated behind KO_RECORDING so the live cron stays group-only until enabled.
if KO_RECORDING:
    for k in fx.get("knockouts", []):
        ko_dt = datetime.fromisoformat(k["kickoff_utc"].replace("Z", "+00:00"))
        if window_start <= ko_dt <= now:
            fixtures.append({
                "kind": "knockout", "post_id": k["id"], "match_no": k["match_no"],
                "kickoff": ko_dt, "venue": k.get("venue"), "stage": k["stage"],
            })

if not fixtures:
    log("no fixtures in window — exiting silently")
    sys.exit(0)

# ── 2. Drop fixtures whose result is already recorded. ───────────
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

pending = [f for f in fixtures if f["post_id"] not in recorded]
if not pending:
    log(f"all {len(fixtures)} candidate fixtures already recorded")
    sys.exit(0)

# ── 3. Fetch ESPN scoreboard across a 3-day window per fixture. ──
def date_window(kickoff):
    return [(kickoff + timedelta(days=d)).strftime("%Y%m%d") for d in (-1, 0, 1)]

dates = sorted({d for f in pending for d in date_window(f["kickoff"])})
log(f"polling ESPN dates={dates} pending={[f['post_id'] for f in pending]} dry_run={DRY_RUN}")

def fetch_espn(date_yyyymmdd):
    url = f"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates={date_yyyymmdd}"
    req = urllib.request.Request(url, headers={"User-Agent": "vtorn-results-poller/0.3"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as ex:
        log(f"WARN ESPN fetch failed for {date_yyyymmdd}: {ex}")
        return None

espn_by_pair = {}   # (h_code, a_code) -> event  (group matching)
espn_events = []    # flat list                  (knockout schedule matching)
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
        st = ((comp.get("status") or {}).get("type") or {})
        try:
            h_score = int(home.get("score", "")) if home.get("score") not in (None, "") else None
            a_score = int(away.get("score", "")) if away.get("score") not in (None, "") else None
        except (TypeError, ValueError):
            h_score, a_score = None, None
        try:
            ev_dt = datetime.fromisoformat((e.get("date") or "").replace("Z", "+00:00")) if e.get("date") else None
        except ValueError:
            ev_dt = None
        rec = {
            "state": st.get("state"), "name": st.get("name"),
            "home_score": h_score, "away_score": a_score,
            "h_code": h_code, "a_code": a_code,
            # ESPN flags the winner on the competitor — authoritative for
            # knockouts decided in ET or on penalties (scores may be level).
            "h_winner": bool(home.get("winner")), "a_winner": bool(away.get("winner")),
            "date": ev_dt, "venue": ((comp.get("venue") or {}).get("fullName") or ""),
        }
        espn_by_pair[(h_code, a_code)] = rec
        espn_events.append(rec)

def is_final(entry):
    name = (entry.get("name") or "").upper()
    state = (entry.get("state") or "").lower()
    return state == "post" and (
        "FULL_TIME" in name or "FINAL" in name or "END_OF_REGULATION" in name
        or "AET" in name or "AFTER_EXTRA_TIME" in name or "_PEN" in name
    )

def venue_match(a, b):
    if not a or not b:
        return False
    a, b = a.lower().strip(), b.lower().strip()
    return a == b or a in b or b in a

def post_result(post_id, payload, label):
    if DRY_RUN:
        log(f"  [DRY_RUN] would POST {post_id}: {json.dumps(payload)}")
        return True
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/v1/match/{post_id}/result", data=body, method="POST",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            # Cloudflare rejects the default Python-urllib UA (error 1010).
            "User-Agent": "Mozilla/5.0 vtorn-results-poller/0.3",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            resp = json.load(r)
        log(f"  {label} rescored={resp.get('rescored_brackets')}")
        return True
    except urllib.error.HTTPError as ex:
        log(f"  {post_id} POST failed: HTTP {ex.code} {ex.reason}")
        return False
    except urllib.error.URLError as ex:
        log(f"  {post_id} POST failed: {ex}")
        return False

# ── 4. Record each pending fixture if its ESPN event is final. ───
posted = 0
for f in pending:
    if f["kind"] == "group":
        entry = espn_by_pair.get((f["home"], f["away"])) or espn_by_pair.get((f["away"], f["home"]))
        if not entry:
            log(f"  m{f['match_no']} {f['home']}v{f['away']}: ESPN has no event yet")
            continue
        if not is_final(entry):
            log(f"  m{f['match_no']} {f['home']}v{f['away']}: not final (state={entry.get('state')} name={entry.get('name')})")
            continue
        h, a = entry["home_score"], entry["away_score"]
        if h is None or a is None:
            log(f"  m{f['match_no']} final but missing scores, skipping")
            continue
        outcome = "home_win" if h > a else "away_win" if a > h else "draw"
        winner = f["home"] if outcome == "home_win" else f["away"] if outcome == "away_win" else None
        payload = {"tournament_id": TID, "outcome": outcome, "homeScore": h, "awayScore": a, "stage": "group"}
        if winner:
            payload["winner"] = winner
        if post_result(f["post_id"], payload, f"m{f['match_no']} {f['home']} {h}-{a} {f['away']} {outcome}"):
            posted += 1
    else:
        # Knockout: match by schedule (kickoff time proximity + venue).
        cands = [e for e in espn_events if e.get("date") and abs((e["date"] - f["kickoff"]).total_seconds()) <= 3 * 3600]
        vmatch = [e for e in cands if venue_match(f.get("venue"), e.get("venue"))]
        pool = vmatch or cands
        if not pool:
            log(f"  {f['post_id']} ({f['stage']} m{f['match_no']}) @ {f.get('venue')} {f['kickoff']:%Y-%m-%dT%H:%MZ}: no ESPN event near kickoff yet")
            continue
        entry = min(pool, key=lambda e: abs((e["date"] - f["kickoff"]).total_seconds()))
        if not is_final(entry):
            log(f"  {f['post_id']} matched {entry['h_code']}v{entry['a_code']}: not final (state={entry.get('state')} name={entry.get('name')})")
            continue
        h, a = entry["home_score"], entry["away_score"]
        # Knockouts have a winner even on level scores (pens). Use ESPN's flag.
        if entry["h_winner"]:
            outcome, winner = "home_win", entry["h_code"]
        elif entry["a_winner"]:
            outcome, winner = "away_win", entry["a_code"]
        else:
            log(f"  {f['post_id']} {entry['h_code']}v{entry['a_code']} final but no winner flag — skipping")
            continue
        payload = {"tournament_id": TID, "outcome": outcome, "homeScore": h, "awayScore": a, "stage": f["stage"], "winner": winner}
        if post_result(f["post_id"], payload, f"{f['post_id']} {entry['h_code']} {h}-{a} {entry['a_code']} -> {winner} ({f['stage']})"):
            posted += 1

log(f"posted {posted} new result(s)" if posted else "no new finals this tick")
PY
