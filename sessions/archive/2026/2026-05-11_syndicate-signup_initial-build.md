# Syndicate signup + GHL contact webhook

- **Task ID:** feat/syndicate-signup-ghl
- **Branch:** `feat/syndicate-signup-ghl`
- **Status:** complete
- **Docs:** docs/26-setup-checklist.md §2.1 (GHL), docs/12 (game
  service), docs/22 (deployment + cache policy)

## Plan

1. Extend reserved-slugs list at
   `apps/web/lib/syndicate/reserved-slugs.ts` with the routing /
   brand entries from the task spec.
2. Slug derivation helper at `apps/web/lib/syndicate/slug.ts`
   (re-exports the existing `isValidSlugShape` so the resolver
   contract is unchanged).
3. SQLite persistence layer at
   `apps/web/lib/syndicate/persistence.ts` — opens the shared
   game-service DB, idempotent `ensureSchema()` for dev/test.
4. Replace the in-memory store stub at
   `apps/web/lib/syndicate/store.ts` with a SQLite-backed
   implementation that preserves the `SyndicateRecord` +
   `loadSyndicateBySlug` contract the `/s/[guid]` resolver depends
   on. Sample syndicates retained as a fallback for dev previews
   without a provisioned DB.
5. Migration `apps/game/migrations/0003_syndicates.sql` — new
   `syndicates`, `syndicate_owners_membership`, and
   `syndicates_pending_ghl` tables. The legacy `syndicate_members`
   stays intact so leaderboard joins keep working.
6. POST `/api/v1/syndicates` route (zod validation, GHL push, retry
   queue on failure).
7. GET `/api/v1/syndicates/:slug/available` route (live availability
   check, <50ms).
8. Form page at `/syndicates/new` (client component, inline success
   card; reads `useUser()` for prefill, never blocks on auth).
9. Tests under `apps/web/__tests__/syndicate/` (5 files, 39 cases).
10. Env-var docs in `apps/web/.env.example` and
    `apps/web/.env.production.example`.

## Key decisions

- **Same DB file as `apps/game`.** Followed the task spec literally —
  the `/s/<slug>` landing page (already shipped by the parallel
  agent) reads from `syndicates.slug` via the game service. Sharing
  the file avoids a cross-process hop on the hot path. The web
  process opens the file via `better-sqlite3` in WAL mode (multiple
  readers, single writer per process is fine for launch). When we
  scale beyond a single Next.js instance, swap the persistence
  module for a call to the game service.
- **Direct GHL call (not via `apps/crm-bridge`).** The crm-bridge is
  the right long-term home, but coupling the public signup to a
  dependent service's uptime on launch day is bad risk. Kept the
  call isolated to `apps/web/lib/syndicate/ghl.ts` with a TODO at
  the call site for the post-launch migration. The dead-letter
  queue (`syndicates_pending_ghl`) holds failures for the daily
  replay.
- **Real `useUser` hook (not stubbed).** Supabase auth shipped on
  the parallel `feat/supabase-auth-identity` branch while I was
  building this; the form now consumes the real hook for prefill,
  while still working when `status === "unconfigured"` or `"guest"`.
- **Inline success card.** Renders on `/syndicates/new` post-submit
  (single URL → simple funnel analytics). A `/syndicates/new/success`
  route exists as a graceful reload-fallback that reads `?slug=`
  from the query.
- **Path-based URLs only.** Hardcoded `play.tournamental.com/s/<slug>`
  via `NEXT_PUBLIC_PLAY_HOST` env. No subdomain logic anywhere.
- **Store kept its `SyndicateRecord` contract.** Replaced the
  in-memory stub with a SQLite-backed `loadSyndicateBySlug` that
  falls back to the sample data when the schema isn't migrated yet
  — preserves the resolver / OG / landing-page contract while
  letting real signups flow through immediately.

## GHL custom-field mapping used

| GHL custom field        | Source on the syndicate row |
| ----------------------- | --------------------------- |
| `syndicate_slug`        | `slug`                      |
| `syndicate_role`        | constant `"owner"`          |
| `syndicate_tournament`  | `tournament_id`             |

Tags applied: `syndicate_owner` + `tournament:<tournament_id>`.

## Verification

- `pnpm --filter @vtorn/web test` — 929 / 929 pass (+39 new in 5
  files).
- `pnpm --filter @vtorn/game test` — 85 / 85 pass (new migration
  doesn't break existing schema).
- `pnpm --filter @vtorn/web build` — clean; new routes
  `/syndicates/new`, `/syndicates/new/success`, `/api/v1/syndicates`,
  `/api/v1/syndicates/[slug]/available` show in the route table.
- `pnpm --filter @vtorn/web lint` — clean (the only warnings are
  pre-existing `no-img-element` warnings in
  `components/syndicate/*` and `components/bracket/TeamFlag.tsx`).

## Surprises

- Origin/main moved fast during the session. By the time I rebased,
  the parallel Supabase auth agent had shipped `useUser` and the
  share-landing agent had shipped the `/s/[guid]` page with
  contract-only stubs for `reserved-slugs.ts` and `store.ts`. I
  extended both files instead of replacing them, which kept the
  resolver tests green and let me focus the diff on the write path.
- `apps/web/app/api/syndicate/intent/route.ts` (the pre-signup
  funnel from a few weeks ago) is still in place. The new
  `/api/v1/syndicates` route is independent — the legacy `intent`
  surface can be retired post-launch once GHL analytics confirm
  nothing is still posting to it.

## Next steps

- Migrate the GHL call to `apps/crm-bridge` once the launch-day
  window closes. The interface is one function (`pushToGhl(row)`)
  → easy swap.
- Wire a daily cron (apps/admin or a new tiny job) to drain
  `syndicates_pending_ghl`.
- Replace the small curated country dial-code list with a
  GeoIP-aware picker once we ship country detection.
- Backfill the `/s/<slug>` landing page member-list rendering — the
  current persistence row only carries `member_count` so we
  hydrate a placeholder member list.
