# 2026-05-12 — Analytics tracking layer (GA4 + GTM dataLayer)

status: ready-for-review
branch: `feat/analytics-tracking-layer`
agent: analytics
doc refs: docs/23, docs/25, docs/26, docs/51 (new)

## Goal

Tim, AFK, said: *"Make sure the Google Analytics layer is tracking
everything."* — wire a complete GA4 + GTM `dataLayer` instrumentation
layer across the Next.js PWA (`apps/web`) and the Astro marketing site
(`apps/marketing`), graceful no-op when the GTM container ID is still
pending.

## Plan

1. SDK in `apps/web/lib/analytics/index.ts` with a typed `EventName`
   union (no typos make it into GA4), helpers for user-properties,
   consent, and a stable pseudo-id for `user_id`.
2. `<GtmRoot/>` injected once in `app/layout.tsx`. Renders nothing when
   `NEXT_PUBLIC_GTM_ID` is empty.
3. Auto page-view via App Router's `usePathname()`.
4. Auto-instrument the call sites the analytics branch owns:
   BracketBuilder (pick saved, autopick, submit, share opened),
   BottomNav (tab change, menu open), match page (match opened),
   molecule page (molecule opened). Sister agents own the rest; the
   taxonomy is locked in `EventName` so their wiring is a one-line
   change each.
5. Marketing-site sibling: `Analytics.astro` head-side bootstrap that
   exposes `window.tournamental.track()` and auto-fires `page.view`,
   plus a click delegator that picks up `data-analytics="cta"` attrs.
6. `ConsentBanner` for first-visit consent capture, GA4 consent-mode
   v2 defaults (analytics granted, ads denied).
7. Tests for the SDK (no-op without GTM, push shape with GTM, hash
   stability, consent envelope, error swallowing) and the consent
   banner (renders/dismisses/persists).
8. `docs/51-analytics-instrumentation.md` — event taxonomy, user
   properties, consent model, how-to-add-event, debug switch.

## What landed

| Path                                                       | Status                                            |
| ---------------------------------------------------------- | ------------------------------------------------- |
| `apps/web/lib/analytics/index.ts`                           | new — typed SDK                                   |
| `apps/web/lib/analytics/usePageView.ts`                     | new — App Router page-view hook                   |
| `apps/web/components/analytics/GtmRoot.tsx`                 | new — `<Script>` + banner + page-view listener     |
| `apps/web/components/analytics/PageViewListener.tsx`        | new                                                |
| `apps/web/components/analytics/ConsentBanner.tsx`           | new — first-visit consent UI                       |
| `apps/web/components/analytics/RouteEvent.tsx`              | new — drop-in for Server Component pages           |
| `apps/web/app/layout.tsx`                                   | small edit — mount `<GtmRoot/>`                    |
| `apps/web/app/match/[id]/page.tsx`                          | small edit — `match.opened` route event            |
| `apps/web/app/world-cup-2026/molecule/page.tsx`             | small edit — `molecule.opened` route event         |
| `apps/web/components/shell/BottomNav.tsx`                   | small edit — `nav.tab.changed` + `nav.menu.opened` |
| `apps/web/components/bracket/BracketBuilder.tsx`            | edit — pick saved, autopick, submit, share opened  |
| `apps/marketing/src/components/Analytics.astro`             | new                                                |
| `apps/marketing/src/components/AnalyticsNoScript.astro`     | new                                                |
| `apps/marketing/src/layouts/Layout.astro`                   | small edit — mount Analytics + NoScript            |
| `apps/marketing/src/pages/blog/[...slug].astro`             | small edit — `blog.post.opened` per post           |
| `apps/marketing/src/components/Hero.astro`                  | small edit — `data-analytics="cta"` attrs          |
| `apps/marketing/src/pages/index.astro`                      | small edit — `data-analytics="cta"` attrs          |
| `apps/web/__tests__/analytics/track.test.ts`                | new — 14 tests                                     |
| `apps/web/__tests__/analytics/ConsentBanner.test.tsx`       | new — 4 tests                                      |
| `docs/51-analytics-instrumentation.md`                      | new — canonical event taxonomy                     |

## Quality gates (all green)

- `pnpm --filter @vtorn/web typecheck` — clean.
- `pnpm --filter @vtorn/marketing typecheck` (astro check) — 0 errors,
  0 warnings, 4 hints (all in pre-existing files, unrelated).
- `pnpm --filter @vtorn/web test` — 66 files / 673 tests pass (18 new).
- `pnpm --filter @vtorn/web build` — clean Next production build.
- `pnpm --filter @vtorn/marketing build` — clean Astro build (21
  pages).

## Deferred wirings (one-line sweeps after sister-agent merges)

These events are in the `EventName` union (so the contract is locked)
but their call sites belong to other agents' branches. Sweep PRs after
each merge:

| Event                                              | Owning branch                            | Call-site hint                                                   |
| -------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| `signup.started/completed/skipped`                 | `feat/user-registration-and-profiles`    | `apps/web/components/auth/SignupModal.tsx` mount/submit/skip      |
| `auth.signin.opened/completed`                     | `feat/user-registration-and-profiles`    | sign-in modal mount + success                                    |
| `profile.field.updated/exported/deleted`           | `feat/user-registration-and-profiles`    | `apps/web/app/profile/page.tsx` action handlers                  |
| `molecule.team.clicked` + `molecule.consensus.toggled` | `feat/molecule-v3-pyramid`           | `<MoleculeScene/>` `onSelect` + consensus toggle                  |
| `match.cam.angle.changed`                          | renderer branches                        | `Director` / `CameraRig` angle-change branch                     |
| `bracket.share.completed`                          | `feat/share-card-and-viral-loop`         | per-channel click in the share modal                             |

Set `identifyUser(uuid)` on signup-success + on every page mount when
a session is present — the registration agent's `/v1/users/me` fetch
is the natural caller. `setUserProperties({...})` should be fired
beside it once that endpoint includes the engagement-band / country
fields.

## Things I deliberately did not do

- Did NOT add Sentry / PostHog / Mixpanel. GA4 only per the spec.
- Did NOT touch `apps/web/lib/bracket/*` (save-API agent's territory),
  `apps/web/components/auth/*` (registration agent's),
  `apps/web/components/molecule/*` (molecule-v3 agent's), or
  `apps/web/app/profile/page.tsx` (registration agent's).
- Did NOT region-gate the consent banner. v2 add (per spec).
- Did NOT undo the `NODE_ENV=production` pin in `apps/web/package.json`.

## Acceptance evidence

- Vitest: 18 new tests, 673 total, 100% pass.
- Build: Next produces all pages; Astro produces all 21 pages.
- Manual: with `NEXT_PUBLIC_GTM_ID=GTM-TEST123` in `.env.local`,
  `window.dataLayer` is populated after first paint and route changes
  push the right envelopes (verified via the debug switch).
- Without the env var set, every `track()` call is a silent no-op
  (the SDK's `getGtmId()` returns `undefined` and short-circuits).

## Next steps

- Sister agents merge → analytics sweeps (one line per deferred event).
- Tim pastes the real `GTM-XXXXXXX` into prod `.env`; verify GA4
  Realtime panel sees the prefix `tournamental.*` events.
- Later (v2): region-aware banner via `CF-IPCountry`; session-replay
  vendor; server-side `/v1/event` mirroring for ad-blocker resilience
  (already specified in docs/23).
