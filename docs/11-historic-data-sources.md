# 11 — Historic Match Data Sources

> Research on what data is actually obtainable for historic matches, with a worked plan for recreating the **2022 FIFA World Cup Final, Argentina 3–3 France (Argentina 4–2 on penalties)** as the v0.2 demo. Bias is toward free, open-licensed, and scrape-friendly sources.

## TL;DR

Free, legal data exists at three fidelity levels for the 2022 World Cup Final:

| Level | Source | What you get | Cost |
|-------|--------|--------------|------|
| **Best free** | **StatsBomb Open Data** | Full event stream (~3,300 events) + 360° freeze-frames (positions of all visible players at every event) + lineups. The whole 2022 World Cup including the final. | Free, MIT-style license. |
| **Good free** | Wikipedia / Wikidata | Player names, jersey numbers, club, photos (CC-licensed in most cases). | Free. |
| **Reference free** | SkillCorner Open Data, Metrica Sports sample, FBref via scrapers | Continuous broadcast-derived tracking on *other* matches. Useful as a tracking-format reference and for cross-validation, not for AR-FR specifically. | Free. |

What is **not** publicly available for the 2022 World Cup:

- **FIFA Hawk-Eye SAOT raw tracking.** FIFA used 12 ceiling cameras + 29 body landmarks per player at 2022, but raw positional data was kept internal (player-app and broadcaster summaries only). No public release.
- **Adidas Al Rihla in-ball IMU data.** The 2022 ball had a 500Hz inertial sensor, used for SAOT and offside detection. Not released to the public.
- **Optical tracking from Genius / Stats Perform / Second Spectrum.** Commercial only.

This is fine. **StatsBomb's open data is enough to build a watchable simulation**, with positional gaps filled by interpolation between freeze-frames. The producer's job is to be honest about what's authoritative and what's synthesised.

## Source 1 — StatsBomb Open Data (the primary source)

GitHub: [statsbomb/open-data](https://github.com/statsbomb/open-data). Clone or sparse-checkout — the repo is ~2GB, mostly because of 360 data.

The 2022 World Cup is competition ID **43**, season ID **106**. The final is identified by date `2022-12-18` and home team `Argentina` in `data/matches/43/106.json`.

### File structure

```
open-data/
├── data/
│   ├── competitions.json                                # all available comps
│   ├── matches/<comp_id>/<season_id>.json               # matches in a competition
│   ├── lineups/<match_id>.json                          # both starting XIs + subs
│   ├── events/<match_id>.json                           # ~3,300 events per match
│   └── three-sixty/<match_id>.json                      # freeze-frames per event
└── doc/                                                 # schema & event-type docs
```

### Event format (the key bit)

StatsBomb events are flat JSON objects with `id`, `period`, `timestamp`, `minute`, `second`, `type` (e.g. `Pass`, `Shot`, `Goal Keeper`), `location` (`[x, y]` on a 120×80 pitch), and event-specific sub-objects. Examples:

```json
{
  "id": "...uuid...",
  "period": 1,
  "timestamp": "00:12:34.567",
  "minute": 12,
  "second": 34,
  "type": { "id": 30, "name": "Pass" },
  "team": { "id": 779, "name": "Argentina" },
  "player": { "id": 5503, "name": "Lionel Messi" },
  "location": [76.5, 40.2],
  "pass": {
    "recipient": { "id": 6620, "name": "Ángel Di María" },
    "end_location": [98.0, 30.5],
    "outcome": null
  }
}
```

Shots include `end_location` with **z** for height, which is rare among public datasets and lets us animate the ball arcing into the net properly.

### 360 freeze-frame format

For each event there's a `three-sixty/<match_id>.json` entry listing all visible players in the broadcast frame at the moment of the event:

```json
{
  "event_uuid": "...",
  "visible_area": [...],
  "freeze_frame": [
    { "teammate": true,  "actor": true,  "keeper": false, "location": [76.5, 40.2] },
    { "teammate": true,  "actor": false, "keeper": false, "location": [80.0, 35.0] },
    { "teammate": false, "actor": false, "keeper": true,  "location": [118.5, 40.0] }
  ]
}
```

Player IDs are NOT on freeze-frame entries — only "is teammate / is actor / is keeper" — so individual identity for non-actor players in freeze-frames must be inferred (e.g. nearest player from the previous resolved frame). This is a known limitation; document it in the producer.

### Coordinate mapping

StatsBomb pitch: 120 long × 80 wide. Origin top-left in their sense; +x toward the attacking goal of the *team in possession*, which flips at half-time. The spec uses pitch-centred metres (105×68, fixed orientation). The producer needs:

```ts
function statsbombToSpec(loc: [number, number], periodTeam: TeamSide): Vec2 {
  // Normalise to pitch-centred metres.
  const x = (loc[0] / 120) * 105 - 52.5;
  const y = (loc[1] / 80) * 68 - 34;
  // Flip if the possessing team is "team 1" and we want a fixed orientation.
  return periodTeam === "left_to_right" ? [x, y] : [-x, -y];
}
```

### License

StatsBomb's open data license permits use for personal projects, blogs, conference submissions, and academic research. Read it in the repo's LICENSE file before redistribution. For an open-source show-and-tell project this is fine.

## Source 2 — Player profiles, names, numbers, photos

We need three things per player: stable name, jersey number for the match, photograph for the billboard face.

### Names + numbers

From StatsBomb's `lineups/<match_id>.json` — comes free. Argentina XI in the final: Martínez, Molina, Romero, Otamendi, Acuña, De Paul, Fernández, Mac Allister, Di María, Messi, Álvarez. France XI: Lloris, Koundé, Varane, Upamecano, Hernandez, Tchouaméni, Rabiot, Dembélé, Griezmann, Mbappé, Giroud.

### Photos

Three viable paths, in order of effort:

1. **Wikidata + Wikimedia Commons (recommended).** Each player has a Wikidata entity with property `P18` (image). Images on Wikimedia Commons are mostly CC BY-SA. Bulk fetch via SPARQL:

   ```sparql
   SELECT ?player ?playerLabel ?image WHERE {
     ?player wdt:P54 wd:Q11193;        # member of (sports team) — too broad alone
             wdt:P1532 wd:Q11193 ;     # country for sport — adjust for nation
             wdt:P18   ?image .
     SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
   }
   ```

   Easier: hand-write a list of 22 Wikidata Q-numbers for the AR-FR XI and fetch each. Q-numbers are stable, e.g. Messi is `Q615`, Mbappé `Q19330496`. The image URL is constructed from the filename via the Commons thumbnail service.

2. **Wikipedia infobox scraping (fallback).** Each player's English Wikipedia page has an infobox with their headshot. Use `mwparserfromhell` or `wptools` (Python). The image URL is exposed via the MediaWiki API at `https://en.wikipedia.org/api/rest_v1/page/summary/<title>` — returns a thumbnail in the JSON.

3. **Headless browser scrape (last resort).** Playwright or Puppeteer against FBref, Sofascore, or the FIFA archive. This works but is brittle and rate-limited. Only if 1 and 2 fail for a specific player.

For an open-source repo, **prefer Wikidata + Commons** because the licensing is clean and traceable. Bundle a `data/players.csv` with `id, name, number, wikidata_q, image_url, attribution`.

### Likeness rights

Player image rights are a separate question from copyright on the photo. For a non-commercial open-source project displaying widely-used press photos at billboard-quality on a stylized 3D body, the practical risk is low; legally it is non-zero. Tim has stated this is acceptable. Document it clearly in the repo README.

## Source 3 — Cross-validation references

Useful for testing the producer pipeline against ground-truth tracking, even if not on AR-FR specifically.

**SkillCorner Open Data** ([github.com/SkillCorner/opendata](https://github.com/SkillCorner/opendata)). 10 matches of broadcast-derived tracking (their CV pipeline, not optical). Australian A-League 2024/25. Includes player tracking at 10Hz on visible players. Use it to test that our renderer can ingest a real tracking-derived stream, not just synthetic.

**Metrica Sports sample data** ([github.com/metrica-sports/sample-data](https://github.com/metrica-sports/sample-data)). 3 anonymised matches with full event + tracking data, in CSV. Coordinates normalised to `[0,1]` on each axis. Good for unit-testing the producer's coordinate translation.

**FBref / Sofascore via scrapers**. Libraries like [`soccerdata`](https://github.com/probberechts/soccerdata) (Python, MIT) and [`worldfootballR`](https://jaseziv.github.io/worldfootballR/) (R, MIT) wrap FBref, Sofascore, ESPN, Understat. Useful for player metadata enrichment (height, position, club) but not events.

## Concrete plan for the v0.2 demo: Argentina 3–3 France

A new producer `apps/statsbomb-replay/` (Python or TS, either works) that:

1. **Boot.** Reads StatsBomb open data from a local clone. Resolves the AR-FR 2022 match by competition 43, season 106, date 2022-12-18.
2. **Lineups → MatchInit.** Reads `lineups/<id>.json`, builds the spec `MatchInit` with both XIs and bench players. Maps StatsBomb `player.id` to a stable spec ID. Looks up Wikidata Q-numbers from a hand-curated lookup table (`data/wc2022-final-players.csv`) and resolves `face_uri` to a Wikimedia Commons thumbnail.
3. **Events → spec events.** Walks `events/<id>.json` in time order. Maps:
   - StatsBomb `Pass` → `event.pass`
   - `Shot` → `event.shot`
   - `Shot` with outcome `Goal` → `event.goal` + `event.score_change`
   - `Foul Committed` → `event.foul`
   - `Goal Keeper` save → `event.save`
   - `Substitution` → `event.substitution`
   - `Half Start / Half End` → `event.period_start / event.period_end`
   - Penalty shoot-out events: not yet in spec; **proposed v0.2 spec extension** below.
4. **Freeze-frames → state synthesis.** For each event with a 360 entry, create a state-frame "anchor" at that timestamp using the freeze-frame positions. For non-anchor moments (between events, ~1–3 seconds typical), interpolate linearly per player toward the next anchor; ball follows event geometry (e.g. between pass start and end). Emit at 10Hz.
5. **Identity inference.** Anchor freeze-frames don't ID non-actor players. Use a Hungarian-algorithm assignment: minimise total displacement between players at frame N and frame N-1 to keep stable identities. Fall back to "nearest formation slot" early in the half.
6. **Time scaling option.** `--time-scale=1` plays in real time (~2.5 hours including ET and pens); `--time-scale=10` for fast dev loop.
7. **Output.** Same WS / SSE / file outputs as the mock producer. Renderer needs zero changes.

### Spec extension proposal (v0.2)

Penalty shoot-out events for the AR-FR final and any future cup match:

```ts
| (EventBase & { type: "event.penalty_shootout_start" })
| (EventBase & { type: "event.penalty_attempt"; player: string; team: string;
                 outcome: "scored" | "missed" | "saved";
                 keeper?: string; target?: Vec3 })
| (EventBase & { type: "event.penalty_shootout_end"; winner: string;
                 score: { home: number; away: number } })
```

Document and ship this as part of v0.2 since AR-FR demands it.

## Cost / effort estimate for AR-FR demo

- Cloning StatsBomb open data + locating the match: 30 minutes.
- Writing the StatsBomb → spec converter: a focused day for a TS or Python agent.
- Player photo curation + Wikidata pull: a few hours, mostly waiting on rate-limited Commons fetches.
- Renderer changes: zero, if the spec extensions for penalties are added cleanly.
- Total: a long weekend's work for one engineer, parallelisable.

## Acceptance criteria for the AR-FR demo

- Renderer plays a stream that, at HUD level, exactly matches the recorded match: 1–0 Messi (23'), 2–0 Di María (36'), 2–1 Mbappé (80' pen), 2–2 Mbappé (81'), 3–2 Messi (108'), 3–3 Mbappé (118' pen), then penalties Argentina 4–2.
- Player nameplate hovers over the right body for events tagged with that player ID.
- Ball position is broadly correct around major events (it lands in the goal on goals; flies toward the keeper on shots).
- Total runtime ≤ 2.5 hours at `--time-scale=1`, ≤ 15 min at `--time-scale=10`.

## Future work: optical / RFID tracking on real games

To get continuous high-fidelity positions for *new* games (not 2022 WC), three paths:

- **Run our own broadcast-derived CV** (TrackNet for ball, ByteTrack for players, jersey-number OCR for ID). This is its own multi-week project; treat it as a separate producer.
- **Buy commercial tracking** (SkillCorner Data On Demand, Stats Perform, etc). Cost-prohibitive for a hobby project.
- **Lay our own RFID/optical tracking on a local amateur match.** UWB tags (e.g. Eliko, Pozyx) cost a few hundred dollars per anchor and give 10Hz positional tracking with sub-metre accuracy. A community pickup game wired up with these and our framework would be a great show-and-tell capstone.

## Sources

- [StatsBomb Open Data — GitHub](https://github.com/statsbomb/open-data)
- [StatsBomb releases free 2022 World Cup data — Statsbomb Blog](https://blogarchive.statsbomb.com/news/statsbomb-release-free-2022-world-cup-data/)
- [StatsBomb 360 Freeze Frame Viewer — Statsbomb Blog](https://blogarchive.statsbomb.com/news/statsbomb-360-freeze-frame-viewer-a-new-release-in-statsbomb-iq/)
- [SkillCorner Open Data — GitHub](https://github.com/SkillCorner/opendata)
- [Metrica Sports sample data — GitHub](https://github.com/metrica-sports/sample-data)
- [`soccerdata` Python library — GitHub](https://github.com/probberechts/soccerdata)
- [`worldfootballR` R library](https://jaseziv.github.io/worldfootballR/articles/extract-fbref-data.html)
- [FIFA Hawk-Eye 2022 World Cup explainer — Medium](https://medium.com/controversial-tech/world-cup-2022-technology-explained-a471acf94b5e)
- [FIFA Player App, 2022 World Cup data insights — FIFA](https://inside.fifa.com/innovation/media-releases/fifa-world-cup-2022-tm-players-to-access-data-insights-through-app)
- [2022 FIFA World Cup squads — Wikipedia](https://en.wikipedia.org/wiki/2022_FIFA_World_Cup_squads)
