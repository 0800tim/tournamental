# 45, Per-match pick popup and game-by-game API

> Browse anywhere → tap any fixture → pick or change pick → no full nav.

## Naming note, Save, not Lock

User-facing copy reads as "Save" / "Saved" everywhere. Internally, the
prediction record still carries `lockedAt` and `oddsAtLock` field names
because the scoring engine consumes them and the 409 `match_already_started`
error code stays. Tim's rule: the **policy** ("you can't change after
kickoff") is intact; the **verb** in the UI is "Save" because a pick is
changeable at any time before kickoff.

## Why

The bracket page (`/world-cup-2026`) shows all 104 matches at once. That's
the right surface for the "save-it-all-in" flow, and it's the only way the
bulk submit endpoint can cover. But the team page (`/team/[code]`), the
match preview page (`/match/[id]/preview`), and (later) social cards all
present an **individual fixture** to the user. Tim's spec:

> "as you're browsing and looking at teams and matches and seeing when
> they're playing… tap on each of those and pop up just that match and
> predict that match, like changing your score."

Two pieces ship together:

1. A **MatchPickPopup** component that can render as a bottom-sheet,
   centered modal, or inline card, same component, same UX,
   reusable from any browse surface.
2. **Per-match pick API** endpoints on `apps/game` so a single
   prediction can be saved atomically without re-encoding the whole
   bracket.

## API, `apps/game`

Mounted alongside the existing `/v1/bracket/*` routes. Same auth model
(dev mesh trusts `X-User-Id` until production wires Telegram + SMS-OTP).

### `PUT /v1/picks/:userId/:matchId`

Atomically save or change a single pick. The path `:userId` must match
the caller's `X-User-Id`; mismatch returns 403. Internally the saved
record carries a `lockedAt` ISO timestamp, that's what the scoring
engine consumes; the user-facing UI calls this "saved".

Body:

```json
{
  "tournament_id": "fifa-wc-2026",
  "outcome": "home_win" | "draw" | "away_win",
  "homeScore": 2,           // optional, 0..99
  "awayScore": 1,           // optional, 0..99
  "oddsAtLock": {           // optional snapshot for lock-time provenance
    "homeWin": 0.50,
    "draw": 0.25,
    "awayWin": 0.25,
    "source": "polymarket",
    "capturedAt": "2026-06-01T00:00:00Z"
  }
}
```

Response (200):

```json
{
  "pick": { "matchId": "1", "outcome": "home_win", "lockedAt": "..." },
  "bracket_id": "bk_u_alpha_fifa-wc-2026_1748736000000",
  "tournament_id": "fifa-wc-2026",
  "stage": "group",
  "cascade_refresh_hint": false
}
```

Errors:

| Status | Code                          | Meaning                                     |
| -----: | ----------------------------- | ------------------------------------------- |
| 400    | `invalid_payload`             | Zod validation failed                       |
| 401    | `missing_user`                | No `X-User-Id` header                       |
| 403    | `user_mismatch`               | `X-User-Id` ≠ path `:userId`                |
| 409    | `match_already_started`       | `now() >= kickoff_utc`                      |
| 422    | `outcome_not_allowed_for_stage` | `outcome=draw` on a knockout match        |
| 429    | `rate_limited`                | >10 writes / 60s for this `(user, match)`   |

### `GET /v1/picks/:userId/:matchId?tournament_id=…`

Returns the user's pick for one match (or 404).

```json
{
  "pick": { "matchId": "1", "outcome": "home_win", ... },
  "bracket_id": "...",
  "tournament_id": "fifa-wc-2026",
  "stage": "group",
  "kickoff_utc": "2026-06-11T19:00:00Z"
}
```

### `DELETE /v1/picks/:userId/:matchId?tournament_id=…`

Removes the pick. Same lockout rule as PUT (409 past kickoff). 404 if
the user has no pick for that match.

### Persistence shape

These endpoints share the same `brackets.payload_json` row that the bulk
submit handler writes. A per-match PUT is a read-modify-write that adds
or replaces a single key in `matchPredictions` (group) or
`knockoutPredictions` (knockouts), so:

- A user can pick game-by-game and then later open the bulk bracket
  builder to see all their picks already populated.
- A user can submit the bulk bracket and then change one pick game-by-game
  without re-submitting everything.

### Audit

Every PUT and DELETE emits a structured pino log line at info level:

```json
{
  "evt": "per_match_pick_put",
  "user_id": "u_alpha",
  "tournament_id": "fifa-wc-2026",
  "match_id": "1",
  "outcome": "home_win",
  "stage": "group",
  "bracket_created": false,
  "locked_at": "2026-06-01T00:00:00Z"
}
```

## Component, `MatchPickPopup`

Located at `apps/web/components/match-pick/MatchPickPopup.tsx`. Three
presentation modes:

- `presentation="sheet"`, bottom sheet on mobile, centered modal on
  desktop. Drag-down to close on touch, Escape on keyboard, X button,
  backdrop click.
- `presentation="modal"`, always centered modal.
- `presentation="inline"`, naked card, no overlay/close button -
  embed inside an existing list (e.g. team page in-line).

Props:

```ts
interface MatchPickPopupProps {
  matchId: string;
  homeTeam: Team;
  awayTeam: Team;
  kickoffIso?: string | null;
  venue?: string | null;
  tournamentId?: string;
  odds?: MatchOdds | null;
  noDraw?: boolean;
  presentation: "sheet" | "modal" | "inline";
  initialPick?: MatchPrediction | null;
  onSaved?: (pick: MatchPrediction) => void;
  onClose: () => void;
}
```

The component re-uses the same kit-coloured selection ring as
`MatchPredictionRow`. The header shows team names + kickoff + venue.
Score steppers reveal after an outcome is picked. A live-odds chip is
rendered when an `odds` prop is supplied; clicking it expands to show
the source + captured-at timestamp (the same data the popup snapshots
into `oddsAtLock`).

### Hook, `useMatchPick(matchId, opts)`

Manages state for one match:

```ts
const { pick, isLoading, isSaving, error, save, remove, refresh } =
  useMatchPick(matchId, { tournamentId, userId });
```

- `save({ outcome, homeScore?, awayScore?, oddsAtLock? })` →
  PUT `/v1/picks/...`
- `remove()` → DELETE `/v1/picks/...`
- `refresh()` → GET `/v1/picks/...`
- On network failure, the hook silently writes to the same
  localStorage draft used by the bulk submit path so the user's pick
  is never lost.

## Wiring

- **Team page**: `app/team/[code]/page.tsx` renders the fixture list via
  `TeamFixturesWithPicks` (client). Each row's "Pick" button opens the
  popup as a sheet. URL gets `?pick=<matchId>` via `history.pushState` so
  the popup state survives back/forward and shareable links.
- **Bracket grid**: `MatchPredictionRow` gets a `⋯` button next to the
  "View match" link that opens the popup with the row's current pick
  pre-selected. Saving via the popup mirrors back into the row state via
  the existing `onChange`.
- **Match preview**: `app/match/[id]/preview/page.tsx` mounts a
  `MatchPickOverlay` client wrapper. URL `?pick=open` (or
  `?pick=<thisMatchId>`) opens the popup on top of the preview.

## Deep-link scheme

| URL                                  | Behaviour                                 |
| ------------------------------------ | ----------------------------------------- |
| `/team/NZL`                          | Team page, no popup.                      |
| `/team/NZL?pick=55`                  | Team page, popup pre-opened on match 55.  |
| `/match/55/preview`                  | Match preview, no popup.                  |
| `/match/55/preview?pick=open`        | Match preview, popup open.                |
| `/match/55/preview?pick=55`          | Same as `?pick=open`.                     |

Closing the popup pops the `pick` search param via `history.pushState`
so the URL stays clean and the back button does the right thing.

## Forward-looking

When `OverlayRouter` (sibling agent's primitive in
`apps/web/components/overlay/`) lands, the popup will also slot into
that stack via `kind: "pick"`. The current self-contained sheet/modal
is the bridge until then.

## Caching

Per `CLAUDE.md` cache matrix, every endpoint here is user-specific so
they all set `Cache-Control: private, no-store`. The team and preview
pages remain `public, s-maxage=…` since the popup state lives entirely
in URL params and client state.

## Performance budget

The popup adds ~3 KB of JS (gzipped) to the bracket and team pages.
`useMatchPick` is hand-rolled (no SWR) to avoid pulling extra deps. The
popup's `<dialog>`-backdrop pattern uses no transitions, sticking to the
LCP < 2.5s budget on mid-range Android.
