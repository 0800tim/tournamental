# Customer-360 admin page

- **Agent**: admin builder
- **Branch**: `feat/admin-customer-360`
- **Doc refs**: `apps/admin/src/app/users/[id]/page.tsx`, `packages/bracket-engine/src/tournament.ts`
- **Status**: complete (pending PR review)

## Plan

Extend the existing admin user-detail page into a 5-tab customer-360
view: Profile + CRM, Predictions ledger, Syndicates, Affiliate revenue,
Clips & social. Add JSON export and soft-delete actions, both gated to
super-admin. Aggregate upstream calls behind a single fetch wrapper that
swallows errors so the page is resilient when individual services
(crm-bridge, social-publisher) aren't running locally.

## Notes

- Existing layout, magic-link auth, and RBAC are untouched. The page
  is still a server component; the 5 tabs are a single client child
  (`Customer360Tabs`) that takes the aggregate as a prop.
- `lib/upstream-fetch.ts` is the shared wrapper. Every upstream GET
  returns `T | null` and logs to stderr on failure. Tests mock
  `globalThis.fetch` directly.
- `lib/customer360.ts` calls six upstream endpoints in parallel via
  `Promise.all`. Each section's null-state renders a "TODO" tile in the
  UI documenting which upstream is missing.
- Export route: `GET /api/users/[id]/export` returns the full aggregate
  as a downloadable JSON, gated to super-admin, audited.
- Delete route: `DELETE /api/users/[id]/data` proxies to apps/api,
  returns 202 if upstream unreachable (the deletion is queued in the
  audit log), 200 on success. Gated to super-admin.

## Upstream endpoints that don't exist yet (TODO list for next agent)

1. `apps/crm-bridge` — `GET /v1/customer/:userId` (separate worktree).
2. `apps/game` — `GET /v1/users/:userId/bracket` and
   `/v1/users/:userId/history` (the `oddsAtLock` field is being added
   on the `feat/per-match-predictions` branch).
3. `apps/game` — `GET /v1/users/:userId/syndicates`.
4. `apps/affiliate-router` — `GET /v1/admin/audit/by-user/:userId`
   (the JSONL writer exists; just needs an HTTP exporter).
5. `apps/social-publisher` — `GET /v1/posts?userId=…` (separate
   worktree).
6. `apps/api` — `DELETE /v1/admin/users/:id/data` (cascades the
   soft-delete).

## Verification

- `pnpm typecheck` clean for `@vtorn/admin` and every workspace package
  that ships a typecheck script. (`apps/marketing` errors with a
  pre-existing astro-check install prompt — not in scope.)
- `pnpm test --run` for `@vtorn/admin`: 94/94 pass (was 80, +14 new).
- `pnpm lint` clean.
- Booted `pnpm dev` locally on port 3340; `/users/test-user` redirects
  to `/login?next=…` as expected (no `DEV_BYPASS_AUTH` flag exists in
  the codebase).
