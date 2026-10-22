---
agent: personal-api-keys
branch: feat/personal-api-keys
worktree: ../vtorn-personal-api-keys
status: in-review
docs:
  - docs/12-odds-and-predictions.md
  - docs/32-auth-and-privacy.md
  - docs/53-mcp-server.md
  - docs/54-personal-api-keys.md
---

# 2026-05-11 — Self-service personal API keys

## Why this exists

Contributors landing on `tournamental.com/engineering` and the
build-on-Tournamental walkthrough (parallel agent #92) need a way to
authenticate writes against the public REST API and the MCP server
without a Supabase session token. The MCP-config block in Claude
Desktop / Cursor / Continue wants a single long-lived string in env;
the Supabase access token won't fit that shape.

## What shipped

1. **`apps/game/migrations/0005_user_api_keys.sql`** — new table with
   `id`, `user_id`, `label`, `key_prefix`, `key_hash`, `scopes`,
   `rate_limit_rpm`, `created_at`, `last_used_at`, `revoked_at`. Indexed
   on `user_id`; UNIQUE on `key_prefix` for O(1) auth lookup.
2. **`apps/game/src/routes/user-api-keys.ts`** — four endpoints:
   - `GET /v1/me/api-keys` (Supabase session OR dev header)
   - `POST /v1/me/api-keys` (Supabase session only, no dev fallback)
   - `DELETE /v1/me/api-keys/:id` (Supabase session OR dev header; 204
     on success, no body)
   - `POST /v1/me/api-keys/:id/regenerate` (Supabase session only;
     revoke + mint in a single SQLite transaction)
3. **`apps/game/src/routes/user-api-keys-crypto.ts`** — token format
   `tnm_live_<32-char-base62>`. Node-native scrypt hashing
   (`scrypt$<saltHex>$<hashHex>`) with the same N=2^14, r=8, p=1
   params `apps/vstamp` uses. No new dep.
4. **`apps/game/src/routes/identity.ts`** — new `resolveAuthFromHeader`
   that fans out the `Authorization: Bearer …` header to either the
   personal-key path (when the token has the `tnm_live_` shape and a
   `store` ref is supplied) or the existing Supabase JWT verifier.
   `resolveUserId` keeps its old signature; `resolveAuthFromHeader`
   returns the resolution source so callers can audit-log the key
   prefix.
5. **`apps/web/app/profile/api-keys/page.tsx`** + the client component
   `apps/web/components/auth/ApiKeysPage.tsx` — the mint / list /
   revoke / regenerate UI. Three-tab code samples for curl, fetch and
   Claude Desktop's `claude_desktop_config.json`. Plaintext is only
   ever in React state; cleared on `pagehide`; never written to
   localStorage.
6. **`apps/web/lib/api-keys/client.ts`** — fetch wrapper that pulls
   the user's Supabase access token via `getSession()` on every call.
7. **`apps/web/components/shell/nav-links.tsx`** — adds "API keys"
   entry to the desktop "More" dropdown.
8. **`apps/web/components/auth/ProfilePage.tsx`** — adds a "Developer"
   section linking to `/profile/api-keys` from the profile editor.
9. **`apps/game/tests/user-api-keys.test.ts`** — 11 new tests covering
   the four endpoints, the auth-resolver fan-out, the
   `last_used_at` bump, and cross-user 404 semantics.
10. **`docs/54-personal-api-keys.md`** (new, ~350 lines).
11. **`docs/22-deployment-and-tunnels.md`** — note the new game-service
    routes.
12. **`docs/53-mcp-server.md`** — link `/profile/api-keys` as the
    place users mint their MCP user-key.
13. **`docs/api/game.openapi.json`** — regenerated via the existing
    `pnpm --filter @vtorn/game openapi:snapshot` script, picks up the
    new endpoints automatically.

## Verification

- `pnpm --filter @vtorn/game test` — **104 passed (12 files)**, includes
  the 11 new tests.
- `pnpm --filter @vtorn/web typecheck` — clean.
- `pnpm --filter @vtorn/game build` — pre-existing 4 Fastify-plugin
  type errors in `src/server.ts` remain. Confirmed identical on
  baseline (`main` without this PR's diff). Not regressed by this PR.
- `pnpm --filter @vtorn/web test` — 1000 of 1003 pass. 3 pre-existing
  failures in `__tests__/AppMenuDrawer.test.tsx` (Syndicates external
  links, Save&share URL, "Create a syndicate" sub-item) — confirmed
  failing on baseline before this PR. Not regressed.

## Notes / decisions

- **Hash algorithm:** Node's `scrypt` (built-in). The task brief said
  "bcrypt or scrypt"; bcrypt is not a workspace dep, scrypt is what
  `apps/vstamp` already uses, no new dep.
- **Plaintext shown ONCE invariant:** enforced top-to-bottom. The DB
  never sees plaintext; the server returns it only in the mint /
  regenerate response; the page only keeps it in React state and
  wipes on `pagehide`.
- **Mint requires verified Supabase session:** the dev-trust
  `X-User-Id` header is rejected on the mint and regenerate
  endpoints, even when `GAME_DEV_AUTH=1` — would otherwise let any
  local-network client provision credentials for any user id.
- **25-key cap per user:** prevents runaway scripts from minting
  thousands; tunable via `MAX_KEYS_PER_USER`.
- **Scope vocabulary:** `bracket:write`, `picks:write`, `share:write`.
  Defaulted-on for new keys. The scope enforcement at call sites is
  parked for v0.2 — for now the scopes are recorded faithfully but
  not yet enforced by individual route handlers.

## Parked for v0.2

- Per-key rate-limit tier change UI (column exists; UI doesn't).
- Per-call scope enforcement at every route handler that accepts a
  personal key (today scopes are advisory; enforced only at the
  /v1/me/api-keys surface).
- Webhook for key revocation so the MCP rate-limit cache invalidates
  in seconds instead of minutes.
- "What did this key call?" call-history drill-down once the MCP
  audit log lands on the dashboard.

## Files

```
apps/game/migrations/0005_user_api_keys.sql                     (new)
apps/game/src/routes/user-api-keys.ts                           (new)
apps/game/src/routes/user-api-keys-crypto.ts                    (new)
apps/game/src/routes/identity.ts                                (modified)
apps/game/src/store/db.ts                                       (modified)
apps/game/src/server.ts                                         (modified)
apps/game/scripts/dump-openapi.run.ts                           (modified)
apps/game/tests/user-api-keys.test.ts                           (new)
apps/web/app/profile/api-keys/page.tsx                          (new)
apps/web/components/auth/ApiKeysPage.tsx                        (new)
apps/web/components/auth/ProfilePage.tsx                        (modified)
apps/web/components/shell/nav-links.tsx                         (modified)
apps/web/lib/api-keys/client.ts                                 (new)
docs/54-personal-api-keys.md                                    (new)
docs/22-deployment-and-tunnels.md                               (modified)
docs/53-mcp-server.md                                           (modified)
docs/api/game.openapi.json                                      (regenerated)
```
