# Vitest repair notes, October 2026

Scope: the non-intl failures in `apps/web` listed in the 2026-10-17 suite
run. Each section says which case applied, what changed, and the result of
a single-file run (`vitest run <file>`).

Cases:

- (a) the product changed on purpose and the assertion was stale
- (b) the test environment was the problem (mock shape, timeout, jsdom)
- (c) the test caught a real product bug or an open product question, so
  the case is marked `it.skip` with an `// OPEN:` comment and the source is
  untouched

Every `// OPEN:` skip in this batch is listed under "Open product issues"
at the end.

## __tests__/DesktopNav.test.tsx (non-intl cases only)

Case (a). Nav labels were renamed in `components/shell/nav-links.tsx`:
"Predict" became "Play (Predict)" (Tim 2026-06-03), "3D Molecule" became
"Molecule" on desktop, and Syndicates became Pools and moved from
MORE_DESKTOP to PRIMARY_DESKTOP (Tim 2026-05-22), so no `/syndicates` link
exists in MORE_DESKTOP any more. Updated the four pure-function cases
(`isLinkActive` x2, `pickActiveLink` x2) and pointed the MORE_DESKTOP case
at Bot Arena, which is the representative More-menu route now.

Result: 11 passed, 3 failed. The three remaining failures are in the
`<DesktopNav />` render block (getByText "3D Molecule", "Predict", and the
Sign in chip) and sit in the intl bucket; they will also need the new
labels once the provider is in place.

## __tests__/OddsChip.test.tsx

Case (b). Passes 13/13 in isolation. The aria-label query in the full run
timed out under load (the chip waits on two mocked fetches; the slowest
cases take 0.4 to 0.8 s alone). No change to the file; the 20 s
`testTimeout` now in `vitest.config.ts` covers it.

## __tests__/ShareSavePage.test.tsx

Case (b). The page gained a sign-in gate (cd6d4d33), reads the draft under
the signed-in user's id, and hydrates from the game-service. None of that
was mocked, so `useUser` stayed loading and the URL fell through to the
`ssr_user` placeholder. Added `vi.mock` for `@/lib/auth/useUser` (signed
in as `test-user-1`, the same id the draft is seeded under, with a null
profile so the URL still resolves to the bracketId) and for
`@/lib/bracket/api` (server read misses).

Result: 6 passed.

## __tests__/TeamFlag.test.tsx

Case (a). The selection ring became a 4px brand-gold outline for every
pick in aa87ef74 (Tim 2026-05-20); the kit colour only drives the CSS glow
now. Assertion updated to 4px and `--vt-gold-400`.

Result: 3 passed.

## __tests__/auth/SignupModal.test.tsx

Case (a). The modal was rebuilt from three Supabase tabs to a single
screen backed by auth-sms (email code, WhatsApp deep-link, Telegram
widget, code paste, channel kill switch). Rewrote the stale cases against
that contract, mocking `fetchChannelsState`, `requestEmailOtp`,
`verifyEmailOtp` and `verifyInboundCode` at the module boundary. Kept the
closed-state and close-button cases.

Result: 7 passed.

## __tests__/bracket-api-client.test.ts

Case (a). SEC-WEB-03 dropped the dev `x-user-id` header; identity rides on
the session cookie via `credentials: "include"`. Assertions now check
`credentials` and that the header is absent.

Result: 7 passed.

## __tests__/calendar-build-rows.test.ts

Case (a). 7d0e07cf sorts rows by kickoff (ties by match_no) so the
day-grouped calendar reads top to bottom. The "sorted by match_no" case
now checks that match numbers 1..104 each appear once and that kickoffs
are non-decreasing with match_no breaking ties.

Result: 6 passed.

## __tests__/import/screenshot.test.ts

Case (b). Passes 17/17 in isolation. The oversized-image case allocates a
6 MB buffer and takes about 3.5 s alone, so it ran past the old 5 s default
under load. No change to the file; covered by the 20 s `testTimeout`.

## __tests__/knockout-flag-backgrounds.test.tsx

Case (a). Two changes: the flag now rides on the `--km-team-bg` custom
property and is painted by a `::before` in bracket.css (Tim 2026-05-22),
and 30d8e1aa folded the "View match" link into the `MatchVenueFooter`
lozenge, which is still an anchor to `/match/<id>/preview`. Assertions
read the custom property and query `a.mpr-venue-footer`.

Result: 12 passed.

## __tests__/molecule-layout-full-bracket.test.ts

Case (b). The test's own cascade builder did not know the `annex_c_third`
slot kind added by fbbc9e32 (FIFA Annex C R32 routing), so eight R32 slots
resolved to null and every downstream count was short. Added a branch that
hands each annex slot a distinct third-placed team.

Result: 8 passed.

## __tests__/molecule-scene-render.test.tsx

Case (b). Passes 3/3 in isolation (0.7 to 1.4 s per case). Timed out under
load in the full run. No change to the file; covered by the 20 s
`testTimeout`.

## __tests__/og-syndicate-route.test.ts

Case (b). The test chdirs into a scratch directory so the disk cache never
lands in `public/og`, but since f35410f6 the route also loads its Fraunces
fonts from `<cwd>/public/fonts`. In the scratch dir the fonts were missing,
the render threw, and the route served its never-500 fallback (1x1 PNG,
`no-store`, no size header). The `beforeAll` now symlinks the real
`public/fonts` into the scratch dir.

Result: 8 passed.

## __tests__/regeneration-deterministic.test.ts

Case (b). Passes 12/12 in isolation (the 1000-bot sample takes about 1 s).
Timed out under load in the full run. No change to the file; covered by
the 20 s `testTimeout`.

## __tests__/save-not-lock-codebase-guard.test.ts

Case (c). The guard (added 2026-05-11 in #129) is doing its job: five files
render user-visible "Lock" copy that arrived after the rename. Marked the
codebase sweep `it.skip` with an `// OPEN:` comment; source untouched and
the guard's regexes unchanged. See the open issue below.

Result: 4 passed, 1 skipped.

## __tests__/share-by-guid/load-bracket-from-guid.test.ts

Case (a). Two changes: 1461c394 surfaces R32 in `path_to_gold` (five rows,
missing stages come back as "TBD"), and 9e2e2748 stripped FIFA branding so
the tournament label is "Football World Cup 2026". Assertions updated.

Result: 7 passed.

## __tests__/syndicate/create-route.test.ts

Case (a). Create now requires a session and resolves the owner's email and
phone from the auth-sms profile instead of the form body (incident
2026-06-03). Mocked `@/lib/auth/session` and `@/lib/auth/contact-lookup`
with a fixed owner so the existing 200/409/GHL cases run unchanged.

Result: 10 passed.

## __tests__/syndicate/form.test.tsx

Case (a). Three changes: Syndicates were renamed Pools in user copy
("Pool name", "Create my pool", "Your pool is live"), the form sits behind
a sign-in gate, and submit requires a handle. Updated the copy and mocked
`useUser` as a signed-in player with a registered handle and no email or
phone on file so the fields stay editable.

Result: 5 passed.

## lib/molecule/test/odds-consensus.test.ts

Case (c). `buildOddsConsensusBracket` has not changed since 2026-05-13 and
never sets `bestThirds`; since FIFA Annex C routing (fbbc9e32) the cascade
needs exactly eight best-third picks to fill the annex R32 slots, so the
consensus bracket stops short of the final. Marked the "through to the
final" case `it.skip` with an `// OPEN:` comment.

Result: 7 passed, 1 skipped.

## Shared helpers and config (the intl, clock and async buckets)

Three changes cover the two largest groups of failures, 91 "no intl
context" errors and 14 async server components rendered as children.

- `__tests__/helpers/render.tsx`: a drop-in for `@testing-library/react`
  whose `render` mounts `NextIntlClientProvider` with `locales/en.json`,
  plus `renderAsync(<Page />)` for `export default async function` pages.
  Eighteen test files now import from here instead of the library.
- `__tests__/helpers/clock.ts`: `pinClockBeforeTournament()` pins `Date` to
  1 May 2026 (only `Date` is faked). The bracket builder and the match
  rows lock picks once the real clock passes a kickoff, which is why
  tests written in June started failing in July. Applied in nine files.
- `vitest.config.ts`: `testTimeout` and `hookTimeout` 20 s. A cold render
  of the 104-row builder takes several seconds under jsdom and the
  default 5 s produced the three STACK_TRACE_ERROR timeouts.
- `locales/en.json`: added `bracket.hero.edit_anytime_dismiss`, which the
  builder's dismiss button asks for and which was missing (next-intl
  logged an error on every render; `safeT` fell back to the English
  string, so users never saw the key).

## __tests__/AppBar, AppBarBurgerViewports, AppShell, MatchPredictionRow.mobile-fit, bracket-mobile-gestures (intl only)

Case (b). Only the import changed. mobile-fit also had one case (a): an
un-timed row is three pick buttons (scores moved inside the buttons, the
venue footer needs a kickoff), was `[5, 6]`.

## __tests__/AppMenuDrawer.test.tsx

Case (a). The drawer is shell-mode aware (#333): live mode shows a "FIFA
World Cup 2026" section and the "Tournamental" brand section, not
App / World Cup 2026 / More. "Save & share" is "Share & Save". The
"Create a syndicate" sub-item left with Pools; that case was removed.

## __tests__/BottomNav.test.tsx

Case (a). Dock labels are Home, Play, Schedule, Leaderboard (Tim
2026-06-03 for "Play"; calendar replaced Watch; Profile moved to the bar).

## __tests__/DesktopNav.test.tsx (render block)

Case (a). "Molecule" and "Play (Predict)" labels; the sign-in chip is a
button that opens the SignupModal, not a link to /profile.

## __tests__/MatchPredictionRow.enrichment.test.tsx

Case (a). The selection ring is the 4 px gold token (aa87ef74), not a
3 px kit-colour ring.

## __tests__/auth/profile-page.test.tsx

Case (a). The guest CTA reads "Sign In/Up". The editor is wired to
auth-sms users (ids starting `u_`); a Supabase-era session shows the
legacy notice. The old "editor when authenticated" and "recovery message"
cases were replaced by one notice case. An inbound editor case needs a
`/v1/auth/me` fetch stub and is left for a follow-up.

## __tests__/autopick-cascade.test.tsx (deleted) and bracket-tabs auto-pick cases

Case (a). Auto-pick was retired on 2026-06-28 (commit 7be699bb): every
entry point, modal and handler was removed on purpose. The cascade file
and the four auto-pick describes in bracket-tabs tested a feature that no
longer exists and were deleted.

## __tests__/bracket-tabs.test.tsx

Case (a) plus the clock. Six tabs with `stage.*` labels ("Group stage",
"Round of 32", ...); the "Top 8 3rds" tab was removed 2026-06-26. The
running total renders as "0/104" plus a label. The header copy case now
checks the hero lede and that the header has no "lock" verb.

## __tests__/per-match-prediction.test.tsx and bracket-odds-integration.test.tsx

Case (b) plus the clock. `useUser` is mocked as a settled guest: the
builder only picks its storage id once auth stops loading, and the real
hook keeps loading in jsdom, so picks were keyed to `ssr_user` and the
localStorage cases could not find them. The group odds stub now answers
as `polymarket`, because `GroupWinnerChips` deliberately hides uniform
mock splits.

## __tests__/kickoff-lockout.test.tsx

Case (a). The locked banner became the lock chip ("In progress", aria
label "Match is in progress and locked").

## __tests__/match-preview-page.test.tsx, team-detail-page.test.tsx, molecule-page.test.tsx

Case (b) for the async pages (`renderAsync`), plus (a): the row's view
link is the venue footer lozenge and only renders with a kickoff; the
team page says "World #1" since FIFA branding was stripped (9e2e2748).

## Open product issues

1. **Lock copy after the Lock to Save rename** (guard test skipped).
   `components/bracket/BracketBuilder.tsx:2062` renders "All 104 picks
   made. Lock in your bracket." (fallback for `bracket.save.complete_headline`,
   added 2026-05-21, ten days after the rename), and `app/odds/page.tsx`
   has "Lock everything upfront" and "Lock in the safer pick". The other
   three hits ("Lock entries by country" in the pool manage views and the
   SyndicateForm country-lock fieldset) are a different feature and
   probably want an allowlist entry in the guard rather than a copy change.
   Needs Tim's call on both before the guard can be re-enabled.
2. **Molecule global-prediction bracket never reaches the final**
   (odds-consensus case skipped). `lib/molecule/odds-consensus.ts` should
   pick eight best thirds (for example by world rank from the group
   orders it already computes) and set `bestThirds` on the bracket before
   the knockout passes. Until then the Polymarket consensus toggle on the
   molecule shows an R32-only bracket.
