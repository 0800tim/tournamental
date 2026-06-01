# 69. Bracket import from competing platforms

> **Status: design.** No code yet. Tim greenlit the build 2026-06-01;
> all-four parsers (Telegraph + ESPN + BBC + FIFA app) + permissive
> retroactive credit + wizard at `play.tournamental.com/import` +
> marketing page at `tournamental.com/switch`.

## 1. Why

Most rival bracket platforms (Telegraph, ESPN, BBC Predictor, FIFA's
own app) lock a user's picks at the first match's kickoff. They can't
change picks after that, even when the bracket is wide open and
new evidence rolls in. Tournamental is different: a user can change
any pick right up to that match's individual kickoff, and prior
picks are scored normally.

The pitch we want to make to a rival platform's player mid-tournament:

> "You're stuck with the bracket you locked on Telegraph. Switch to us,
> we'll import every pick you've already made, credit you the points
> for matches that have already played, and from here on you can keep
> changing the rest as the tournament evolves."

That's the entire feature.

## 2. User-facing flow

```
   not signed in                signed in                 imported
   ─────────────                ─────────                 ────────

   /switch  ─────────►   /login  ────────►   /import  ───────►   /world-cup-2026
   marketing page         OTP via             wizard               their bracket,
                          WhatsApp/email                            with imports applied
                          (already built)
```

1. Visitor lands on **`tournamental.com/switch`** from search (`telegraph bracket import` etc.) or social.
2. Marketing page sells the pitch, lists supported platforms, links to the wizard.
3. Visitor signs up if they aren't already (existing flow).
4. They hit **`play.tournamental.com/import`** as a signed-in user.
5. Wizard:
   - **Step 1**: pick the source platform (Telegraph / ESPN / BBC / FIFA / Other).
   - **Step 2**: paste the public share URL of their bracket on that platform.
   - **Step 3**: we fetch + parse + show a preview of every pick we found, with our team-code mapping + the source's team name side by side.
   - **Step 4**: confirm. We save the picks to their Tournamental bracket. Matches that have already kicked off lock immediately and credit any earned points; matches still upcoming stay editable on Tournamental.
6. Done. Land them on the standard bracket page, scrolled to whatever the next upcoming match is.

## 3. Schema

### 3.1. Migration `apps/game/migrations/0012_bracket_imports.sql`

```sql
-- New columns on the existing brackets table for import provenance.
ALTER TABLE brackets ADD COLUMN imported_source TEXT;        -- 'telegraph' | 'espn' | 'bbc' | 'fifa' | 'manual' | 'screenshot-ai'
ALTER TABLE brackets ADD COLUMN imported_from_url TEXT;      -- public bracket URL on the source platform
ALTER TABLE brackets ADD COLUMN imported_at INTEGER;         -- epoch ms

-- Audit log: one row per import attempt, success or failure. Stores the
-- parsed picks + raw HTML response so we can investigate disputes.
CREATE TABLE IF NOT EXISTS bracket_import_audit (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  bracket_id      TEXT,                       -- null if import failed before save
  source          TEXT NOT NULL,
  source_url      TEXT NOT NULL,
  fetched_at      INTEGER NOT NULL,
  status          TEXT NOT NULL,              -- 'parsed' | 'partial' | 'failed' | 'committed'
  http_status     INTEGER,
  parsed_json     TEXT,                       -- the structured picks we extracted
  raw_html_sha256 TEXT,                       -- hash of the source HTML for dispute resolution
  raw_html_path   TEXT,                       -- on-disk path to the cached raw HTML
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_bracket_import_audit_user ON bracket_import_audit(user_id, fetched_at DESC);

-- Pool-owner toggle. Default ON for warm pools (the launch buzz pitch).
-- Sweepstake-with-money pools can switch off.
ALTER TABLE syndicates ADD COLUMN accept_imports_after_kickoff INTEGER NOT NULL DEFAULT 1;
```

### 3.2. `@tournamental/spec` change

`MatchPrediction` gains two optional fields:

```ts
interface MatchPrediction {
  matchId: string;
  outcome: "home_win" | "away_win" | "draw";
  lockedAt: string;
  oddsAtLock?: { ... };
  /** Where this pick came from. Default 'live' (i.e. saved on
   *  Tournamental before kickoff via the bracket builder). */
  source?: "live" | "imported";
  /** For imported picks: the ISO timestamp we believe the user
   *  locked their pick on the source platform. Default to the
   *  kickoff time minus 1ms for already-played matches when the
   *  source doesn't expose a per-pick timestamp. */
  originalLockedAt?: string;
}
```

### 3.3. Server-side backstop adjustment

`apps/game/src/routes/bracket.ts::filterPredictionsByKickoff` currently
rejects any pick whose `lockedAt >= kickoff`. We extend it: imported picks
bypass that check, BUT only when:

- The bracket's `imported_source` is set (so we know it's an import-context save).
- The pool's `accept_imports_after_kickoff = 1` (or the bracket has no pool yet, the user's own personal bracket).

Live picks (no `source` field, or `source='live'`) still go through the
existing kickoff backstop.

## 4. The parsers

Four sources for v1. Each implements:

```ts
interface BracketParser {
  readonly source: "telegraph" | "espn" | "bbc" | "fifa";
  /** Validate that the URL looks plausible for this source. */
  canParse(url: string): boolean;
  /** Fetch + extract picks. Returns the raw parsed structure;
   *  caller maps team codes + reconciles to our match ids. */
  parse(url: string, fetcher: Fetcher): Promise<ParseResult>;
}

interface ParseResult {
  matches: Array<{
    homeTeamRaw: string;     // "Argentina" / "ARG" / whatever the source uses
    awayTeamRaw: string;
    predictedWinnerRaw: string | "draw";
    kickoffHint?: string;    // optional: helps reconcile to our matchId when team names ambiguous
    sourceMatchId?: string;
    sourceTimestamp?: string;  // when we believe the pick was locked
  }>;
  championRaw?: string;
  runnerUpRaw?: string;
}
```

Each parser lives at `apps/web/lib/import/parsers/<source>.ts`.

Fetcher is a wrapper:
- Default: plain `fetch` with our UA, 10s timeout.
- Fallback: spawn a Playwright Chromium for JS-rendered pages. ESPN
  is the likely candidate; the others render server-side.

### 4.1. Build order

1. **Telegraph** first (Tim mentioned it by name; UK + NZ overlap; server-rendered).
2. **BBC Sport** second (Predictor share URLs are stable + server-rendered).
3. **FIFA app** third (official; their share URLs include a JSON blob).
4. **ESPN** last (heaviest; JS-rendered; biggest cohort but slowest to parse).

Each parser ships with unit tests against three fixture HTML snapshots
captured live + frozen under `apps/web/lib/import/parsers/__fixtures__/`.

### 4.2. LLM screenshot fallback (Phase 2)

If a user is on an unsupported platform, the wizard offers a
"Upload a screenshot of your bracket" path. The screenshot goes to
Anthropic API with a structured-output prompt that returns the same
`ParseResult` shape. Cost: ~$0.02 per import. Not in v1 but the
wizard's Step 1 carries the "Other" option that explains it's coming.

## 5. Team-name normalisation

Source platforms use a mix of: full English name ("Argentina"),
ISO 3-letter code ("ARG"), flag emoji, flag image URL, FIFA code,
nation-abbreviation Anglicised differently ("S Korea" vs "South Korea"
vs "KOR" vs "Korea Republic" vs "KSA"...).

We need one shared normaliser:

```ts
// packages/spec/src/team-normalise.ts (new file)
export function normaliseTeamName(raw: string): TeamCode | null;
```

Backed by a comprehensive alias table. Test against samples from each
parser's fixture HTML.

## 6. Anti-cheat for v1 (permissive default)

Per Tim's decision: lenient but auditable.

- Server-side fetch only. Never trust client-supplied HTML.
- One import per Tournamental bracket (no re-import).
- Pool-owner toggle `accept_imports_after_kickoff` lets prize pools opt out.
- Every import logs to `bracket_import_audit` with raw HTML on disk.
- Per-IP + per-user rate limit on the import API (5/hour, 20/day).
- Marketing copy frames it as "switching" not "back-dating": positions
  the feature as goodwill, not exploit.

Fast-follow (post-launch buzz): Wayback corroboration on
`web.archive.org` for high-stakes pools.

## 7. Marketing page (`tournamental.com/switch`)

Astro page in `apps/marketing/src/pages/switch.astro`.

Sections:

1. **Hero**: "Switch to Tournamental in 60 seconds. Keep every pick.
   Change the rest." Subhead names the pain: "Stuck with a bracket on
   Telegraph / ESPN / BBC / FIFA app that locked at the first kickoff?
   Bring it over."
2. **How it works**: 4 steps, illustrated.
3. **Per-platform instructions**: collapsible blocks, one per source,
   each showing how to find the public bracket URL on that platform.
4. **The "you can keep changing" advantage**: visual diff of locked vs
   editable.
5. **"What we do / what we don't"**: short trust block. We never read
   your password, we never post on your behalf, we only read the public
   share URL you give us, here is what we store, here is how we delete it.
6. **CTA**: "Start your switch" → `play.tournamental.com/import`.

## 8. Build phases

| Phase | Deliverable | Estimate |
|-------|-------------|----------|
| 0 | This doc + alignment | done |
| 1 | Schema migration + spec change + server-side backstop | ½ day |
| 2 | Telegraph parser + team-normaliser + fetcher + audit | 1 day |
| 3 | Wizard UI at `/import` (3-step form, preview, commit) | 1 day |
| 4 | BBC + FIFA + ESPN parsers (extend tests) | 2-3 days |
| 5 | Marketing page at `tournamental.com/switch` | 1 day |
| 6 | Pool-owner toggle on manage page | ½ day |
| 7 | LLM screenshot fallback | 1 day (post-launch) |
| 8 | Wayback corroboration | ½ day (post-launch) |

Total to ship-able with Telegraph only: ~3 days.
Total to four-parsers + marketing page: ~6 days.

## 9. Open questions

- Do we want a "claimed-by" badge on a user's profile that says
  "imported from Telegraph", as a soft proof-of-honesty signal? Soft
  yes, but maybe Phase 2.
- For the LLM screenshot path, do we cap to one image or accept a
  bracket spread across multiple screenshots (more useful for ESPN
  where the bracket is wide)?
- Multi-tournament: do we let a user import a 2022 bracket into a
  retrospective Tournamental pool? Out of scope for v1.

## 10. References

- `apps/game/src/routes/bracket.ts::filterPredictionsByKickoff` - the
  kickoff backstop we need to relax for imports.
- `packages/spec/src/index.ts` - the `MatchPrediction` shape.
- `apps/web/components/bracket/BracketBuilder.tsx` - where saved
  imports show up post-commit.
- `apps/web/app/api/v1/syndicates/[slug]/invites/route.ts` - the
  closest existing CSV-upload pattern; the wizard reuses the
  drag-drop + preview + commit lifecycle.
