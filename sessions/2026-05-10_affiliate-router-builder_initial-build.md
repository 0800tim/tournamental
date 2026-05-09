# 2026-05-10 — affiliate-router builder — initial build

**Status**: complete
**Branch**: `feat/affiliate-router-paytv`
**Refs**: docs/30-gamification-and-affiliate-spine.md, docs/18-monetization.md, docs/22-deployment-and-tunnels.md, docs/33-security-hardening-checklist.md

## Plan

Stand up `apps/affiliate-router/` — a Fastify service on `:3370` that
resolves affiliate clicks for the bracket "back your boldest pick" CTA, the
WC marketing pages, and the live-match second-screen. Geo-gates by
`cf-ipcountry`, applies per-IP and per-(user, partner) caps, writes an audit
log, and 302s the visitor to the partner with our affiliate code attached.
NZ hard rule: never serve Polymarket links to NZ visitors.

## Outcome

Shipped:

- `apps/affiliate-router/` Fastify service (Node 20, ESM, strict TS).
- Endpoints: `GET /v1/affiliate/click`, `GET /v1/affiliate/partners`,
  `GET /healthz`.
- Partner registry in `data/partners.json` (Zod-validated on boot) with five
  partners: Polymarket (US/CA), Bet365 (UK/EU/AU), Sky Sport NZ (NZ),
  ESPN+ (US), DAZN (DE/IT/ES/JP). Real codes loaded from env at boot
  (`AFFCODE_<PARTNER_ID_UPPER>`); placeholders in the JSON.
- Geo-gating: `cf-ipcountry` first, `?country=` fallback. Hard-coded
  defence-in-depth NZ + Polymarket exclusion in `partners.ts` so a misedit
  of `partners.json` cannot open the gate.
- Throttling: per-IP 30/min via `@fastify/rate-limit`, per-(user, partner)
  3/24h via the SQLite click-log count.
- Audit log: SQLite (`better-sqlite3`) at `data/clicks.db`.
  `user_id_hash = SHA-256(user_id || AFFILIATE_USER_HASH_SALT)`. Raw
  `user_id` never persisted, never logged.
- 76 vitest tests covering every endpoint, geo gating (NZ excluded for
  Polymarket via header AND via `?country=` override), partner-not-found,
  throttle behaviour (per-IP plugin + per-user/partner cap including window
  slide), audit-log writes, hash determinism, partner-registry env override,
  duplicate-id detection.
- README, `.env.example`, `.gitignore` (clicks.db, .env, dist).
- `docs/22-deployment-and-tunnels.md` updated: port 3370, tunnel
  `vtorn-aff.aiva.nz` → `aff.vtourn.com`, two new rows in the caching matrix
  (click route is `no-store`; partners list is edge-cacheable).

## Key decisions

1. **Partner kind enum** (`prediction-market`, `sportsbook`, `paytv-stream`)
   so the frontend `<AffiliateCTA>` component can pick copy/colour by kind
   without a second config.
2. **`vt_*` sub-id pass-through** (`vt_surface`, `vt_match`, `vt_team`,
   `vt_campaign`) so partner-side reconciliation has our context even when
   the partner ignores most params. Most partner consoles accept arbitrary
   sub-ids.
3. **Anonymous clicks bypass per-user cap** — only the per-IP plugin caps
   them. Decided this is acceptable because anonymous clicks can't generate
   attributable revenue anyway, and a NULL `user_id_hash` would otherwise
   collapse all anonymous traffic into a single dedupe bucket.
4. **NZ-Polymarket exclusion in code, not just JSON.** Two redundant gates:
   `Partner.allowed_countries` and the explicit `nzPolymarketExclusion`
   helper. Per docs/30 + docs/18 NZ DIA constraint this rule must not be
   editable by JSON alone.
5. **Don't log raw user_id.** Only `has_user: bool` appears in the click log
   to avoid PII leakage into ops logs.

## Tests

```
 Test Files  6 passed (6)
      Tests  76 passed (76)
```

`pnpm --filter @vtorn/affiliate-router typecheck` clean.
`pnpm --filter @vtorn/affiliate-router build` produces `dist/`.

## Per-country partner table (from partners.json)

| Country | Polymarket | Bet365 | Sky NZ | ESPN+ | DAZN |
|---------|------------|--------|--------|-------|------|
| NZ      | NO (hard rule) | no     | yes    | no    | no   |
| US      | yes        | no     | no     | yes   | no   |
| CA      | yes        | no     | no     | no    | no   |
| GB      | no         | yes    | no     | no    | no   |
| AU      | no         | yes    | no     | no    | no   |
| DE      | no         | yes    | no     | no    | yes  |
| IT      | no         | yes    | no     | no    | yes  |
| ES      | no         | yes    | no     | no    | yes  |
| JP      | no         | no     | no     | no    | yes  |
| FR/NL/BE/AT/DK/SE/IE | no | yes | no | no | no   |

## What's NOT in this PR (parking)

- The bracket-side `<AffiliateCTA>` component — that lives in `apps/web/`
  per docs/30 and is owned by the bracket-engine agent.
- Real affiliate codes — `AFFCODE_*` placeholders only. Tim onboards each
  partner separately and sets the env vars in the prod secret store.
- Postback/webhook reconciliation against partner consoles (separate agent).
- The cloudflared ingress for `vtorn-aff.aiva.nz` (per CLAUDE.md, the
  tunnel is remote-managed; Tim can add the rule via the API procedure
  documented in docs/22 once this PR merges).
- Logo SVGs at `https://cdn.vtourn.com/partners/*.svg` — placeholder URLs
  reference our CDN; uploads happen post-merge.
- The Polymarket affiliate paperwork open question (docs/30 § Open
  questions for Tim — registration is not blocked by this PR).

## Next steps

- Bracket-engine agent wires `<AffiliateCTA>` to call `/v1/affiliate/click`
  with `surface=bracket`.
- Marketing agent wires WC landing CTAs with `surface=marketing`.
- Tim adds `aff.vtourn.com` ingress (API procedure in docs/22) once the
  service is deployed.
- Tim sets `AFFILIATE_USER_HASH_SALT` and per-partner `AFFCODE_*` in the
  prod secret store.
