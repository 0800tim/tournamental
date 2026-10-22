# Save API Live — End-to-end

**Status**: complete, awaiting Tim's review + admin-merge.
**Branch**: `feat/save-api-live`
**Worktree**: `/home/clawdbot/clawdia/projects/vtorn-save-api`

## Goal

Replace the localStorage-only stub at `apps/web/lib/bracket/submit.ts` with a real
round-trip to the game service so picks made on `play.tournamental.com` persist
to the server SQLite DB and survive a page reload from any device.

## Steps taken

### 1. Game service brought up under PM2

- Created `apps/game/.env.production` (gitignored) at the canonical repo path
  with `GAME_DB_PATH` absolute, the four Tournamental CORS origins, and a
  freshly-rotated `GAME_ADMIN_TOKEN` (kept out of git).
- `apps/game/data/` mkdir'd; better-sqlite3 creates `game.db` + WAL on boot
  via `applyMigrations()` (idempotent migrations live in
  `apps/game/migrations/000N_*.sql`).
- Built the service: `pnpm --filter @vtorn/game build` (the same `tsc` that the
  test suite uses).
- Discovered `node dist/server.js` fails because the workspace package
  `@vtorn/bracket-engine` has its `main` pointed at a `.ts` source file (no
  build step for that package), so `dist/.../bracket-engine/src/tournament.js`
  doesn't exist. Fix: PM2 boots the game service via `tsx src/server.ts` with
  `--env-file-if-exists=…/.env.production` so workspace `.ts` imports resolve
  at runtime and the env file is loaded without dragging dotenv into the app
  itself. The whole change is the new `fastifyAppTsx()` helper in
  `infra/deploy/pm2/production.config.cjs` — only the game app uses it for now.
- PM2: `vtorn-game-prod` listening on `:3360`, autorestart, max-mem 512M,
  single instance (SQLite is single-writer, clustering would just queue writes
  behind the WAL). `pm2 save` persisted.

### 2. Cloudflare tunnel ingress

- New script `infra/scripts/cf-add-game-host.sh` (copy of `cf-add-play-host.sh`
  pattern, swapped port + hostname). Adds `game.tournamental.com → :3360` to
  the `clawdbot-workstation` tunnel and creates the proxied CNAME.
- Idempotent — both the ingress patch and the CNAME create are skipped if
  already present.
- Smoke: `curl https://game.tournamental.com/healthz` → `{"ok":true,"db":"up"}`.

### 3. Web client — replace the stub with the real client

New file `apps/web/lib/bracket/api.ts` exposes:

- `savePerMatchPick({userId, matchId, tournamentId, outcome, …})` →
  `PUT /v1/picks/:userId/:matchId` with `X-User-Id` header.
- `saveFullBracket({userId, tournamentId, bracket})` →
  `POST /v1/bracket/submit`.
- `loadServerBracket({userId, tournamentId})` →
  `GET /v1/bracket/me?tournament_id=…`.

Each call has a 4s `AbortController` timeout, returns a discriminated
`ApiResult<T>` (`ok: true` with shaped data, or `ok: false` with a structured
error code), and is base-URL-overridable for tests.

Base URL: `NEXT_PUBLIC_GAME_API_URL` (`https://game.tournamental.com` in prod,
`http://localhost:3360` in dev). `useMatchPick.ts` and `lib/pundit.ts` already
talked to `process.env.NEXT_PUBLIC_VTORN_GAME_URL` so I kept that as a legacy
fallback and added the canonical var on top — no breaking config rename.

### 4. Wire the bracket builder

- `BracketBuilder.tsx`:
  - On mount: call `loadServerBracket()` once. If the server has a bracket,
    merge it with the local draft (newer `lockedAt` wins per-match) and persist
    the merged result so the next reload is offline-tolerant.
  - `onChangeMatch` (group stage) and `onChangeKnockout` (R32–F) now also call
    `savePerMatchPick()` fire-and-forget. The local state update is
    synchronous; the network is best-effort with a console.warn on soft
    failures (no banner spam on offline).
  - `handleSubmit` (Save bracket on Final tab) calls `submitBracket()` which
    now hits `POST /v1/bracket/submit`. On 2xx → "Bracket saved. You can change
    any pick before kickoff." On 5xx/timeout/network → "Saved offline — we'll
    retry when you're back online." (localStorage is always written first so
    the click never feels dropped.)
  - The pre-PR "Draft saved locally. API not live yet — see browser console."
    is gone.
- `lib/bracket/merge.ts`: new pure function for the local↔server merge. Newer
  `lockedAt` per match wins; server `bracketId` takes precedence (so subsequent
  per-match writes land on the same row).
- `lib/bracket/submit.ts`: rewritten — calls `saveFullBracket()`, falls back
  to "saved offline" on transport / 5xx; returns a richer `SubmitResult` that
  surfaces server-side `rejected` predictions ("couldn't save N picks: matches
  already started").
- `lib/pundit.ts` + `components/match-pick/useMatchPick.ts`: updated their
  default base URLs from the stale `game.tournamental.com` host to
  `game.tournamental.com`, and now consume the same `NEXT_PUBLIC_GAME_API_URL`
  env var (with the legacy var still honoured for back-compat).

### 5. Tests (new, all green)

`apps/web/__tests__/bracket-api-client.test.ts` — 7 tests covering URL,
headers, body, success + 4xx + network-error paths for all three endpoints.

`apps/web/__tests__/bracket-submit.test.ts` — 4 tests covering server-success
+ network-error + 5xx + 4xx fallback states + localStorage round-trip.

`apps/web/__tests__/bracket-merge.test.ts` — 4 tests covering newer-wins,
one-sided picks preserved, server bracketId precedence, tiebreaker merge.

Full web suite: **670 / 670 tests passing**.
Web typecheck: clean (`pnpm --filter @vtorn/web typecheck`).
Game typecheck: clean (`pnpm --filter @vtorn/game typecheck`).
Web build: clean (`pnpm --filter @vtorn/web build`).

### 6. Live round-trip smoke test (production)

Browser-driven via Playwright against `https://play.tournamental.com`:

1. Clear localStorage, set a known user id.
2. Navigate to `/world-cup-2026#r32`.
3. Click "Czech Republic — pick to advance from R32 #73".
4. Captured network request:
   `PUT https://game.tournamental.com/v1/picks/8097fa32-4005-4fa0-8b4a-fd617a6ce4c7/r32_01 → 200`.
5. Server-side verification (SSH'd into the box):

   ```
   $ sqlite3 /home/clawdbot/clawdia/projects/vtorn/apps/game/data/game.db \
     "SELECT id, user_id, datetime(locked_at/1000, 'unixepoch'), \
             json_extract(payload_json, '\$.knockoutPredictions.r32_01') \
        FROM brackets WHERE user_id LIKE 'smoke_%' OR user_id LIKE '%4005-%' \
        ORDER BY locked_at DESC LIMIT 5;"

   bk_8097fa32-4005-4fa0-8b4a-fd617a6ce4c7_fifa-wc-2026_1778465875832
     | 8097fa32-4005-4fa0-8b4a-fd617a6ce4c7 | 2026-05-11 02:17:55
     | {"matchId":"r32_01","outcome":"home_win","lockedAt":"2026-05-11T02:17:55.832Z"}

   bk_smoke_test_2026_05_11_c_fifa-wc-2026_1778465644856
     | smoke_test_2026_05_11_c               | 2026-05-11 02:14:49
     | {"matchId":"r32_01","outcome":"home_win","lockedAt":"2026-05-11T02:14:04.856Z"}

   bk_smoke_test_2026_05_11_b_fifa-wc-2026_1778465493050
     | smoke_test_2026_05_11_b               | 2026-05-11 02:11:33
     | {"matchId":"r32_01","outcome":"home_win","lockedAt":"2026-05-11T02:11:33.050Z"}
   ```

6. Reloaded the page → the Czech Republic button's `aria-label` is
   `"Czech Republic — currently picked to advance from R32 #73"` and
   `aria-pressed="true"` — the pick was rehydrated from
   `GET /v1/bracket/me` (the only source, since localStorage was empty by then).

### Screenshots

- `sessions/screenshots/2026-05-12_save-api-live_picked-r32.png` — bracket
  with Czech Republic selected post-click.
- `sessions/screenshots/2026-05-12_save-api-live_reload-hydrated.png` — same
  state after a hard reload (no localStorage in the picture; the pick comes
  from the server via the new `loadServerBracket()` hydration step).
- `sessions/screenshots/2026-05-12_save-api-live_picked.png` — earlier capture
  with the same state, kept for reference.

(I tried to capture a Network-panel-style screenshot but Playwright's
in-process console doesn't render DevTools chrome; the network log itself is
in this note and the screenshots show the post-save UI state.)

## CORS

Verified preflight against the live host:

```
$ curl -X OPTIONS \
  -H "Origin: https://play.tournamental.com" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type,x-user-id" \
  -D - https://game.tournamental.com/v1/picks/u_test/42 -o /dev/null

HTTP/2 204
access-control-allow-credentials: true
access-control-allow-headers: content-type,x-user-id
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
access-control-allow-origin: https://play.tournamental.com
vary: Origin, Access-Control-Request-Headers
```

## Deferred work (next sessions)

- **Production auth model**. The game service still trusts `X-User-Id` from
  the client (dev-mesh model, per `apps/game/src/routes/picks.ts:53`).
  Production needs the Telegram-session JWT path from `docs/13` /
  `docs/32`. Until then, anyone who knows another user's id can write their
  bracket; for the bracket-prophet game this is more annoying than dangerous
  but it has to be fixed before we launch a money pool.
- **Rejected-predictions UX**. `submitBracket()` now surfaces the server's
  per-match rejections; the Final-tab toast appends a parenthetical
  ("2 picks skipped — match already started") but a richer per-match
  inline indicator would be friendlier.
- **Service-worker cache eviction**. The browser session I tested with had
  an old service worker registered that occasionally redirected to a
  different localhost dev server in this multi-worktree setup. Unregistering
  it fixed the test. We may want a one-shot SW eviction on the next
  production deploy so existing users don't hit the same trap.

## Files changed

- `apps/web/lib/bracket/api.ts` — new, thin fetch client.
- `apps/web/lib/bracket/submit.ts` — rewritten, talks to the real endpoint.
- `apps/web/lib/bracket/merge.ts` — new, local↔server merge.
- `apps/web/lib/pundit.ts` — updated base URL.
- `apps/web/components/bracket/BracketBuilder.tsx` — hydration on mount +
  per-match save on change + updated user-visible save copy.
- `apps/web/components/match-pick/useMatchPick.ts` — env-var name aligned.
- `apps/web/__tests__/bracket-api-client.test.ts` — new (7 tests).
- `apps/web/__tests__/bracket-submit.test.ts` — new (4 tests).
- `apps/web/__tests__/bracket-merge.test.ts` — new (4 tests).
- `infra/deploy/pm2/production.config.cjs` — `fastifyAppTsx()` helper +
  the game-prod entry now uses it (single instance).
- `infra/scripts/cf-add-game-host.sh` — new tunnel-ingress script.

## PR

`feat(game,web,infra): bring save API live end-to-end`
