---
title: Code review, five draft PRs of 17 October 2026
date: 2026-10-20
scope: "#335 middleware host modes, #336 register-interest hardening, #343 archive round of 32, #345 security headers, #348 accessibility of hub, archive and shell"
base: origin/main at e1e0eac9
method: read-only review of the branch diffs and the code paths they touch; nothing was built, run or tested
---

# Code review: draft PRs #335, #336, #343, #345, #348

All five branches were diffed against `origin/main` (e1e0eac9), except #343 which was diffed against its stacked base `origin/test/archive-standings-fixtures`. Every claim below was checked by reading the code on the branch and the code it calls. Where a claim depends on production data or on a build I could not run, it is marked "unconfirmed".

Severity: high means user-visible breakage or a security regression on a live host after merge; medium means wrong in an edge case users will hit, or a stated fix that does not fully hold; low means hygiene.

## Summary

| PR | High | Medium | Low | Recommendation |
| --- | --- | --- | --- | --- |
| #335 middleware host modes | 0 | 1 | 2 | Merge with fix: run the SEC-WEB-01 Origin guard on `routePath`, not `path` |
| #336 register-interest security | 0 | 1 | 4 | Merge with fix: run `ARCHIVE_BLOCKED_API` on the locale-stripped path |
| #343 archive round of 32 | 0 | 1 | 3 | Merge with fix, after its base branch: map a `final` match id to stage `f` in the loader |
| #345 security headers | 1 | 1 | 5 | Hold: the framing rule blanks every in-iframe click inside the partner embed on the archive host today and in live mode later |
| #348 accessibility | 0 | 1 | 5 | Merge; resolve the `archive/page.tsx` conflict with #343 by hand |

## PR #335: `test/archive-middleware-host-modes`

Files: `apps/web/middleware.ts` (commit a29e3592), tests under `apps/web/__tests__/platform/`.

The change adds `routePathOf()` which strips a supported locale prefix and uses the stripped path for the archive block list, the hub allow list, the invite-link match, the legal redirects and the `/` rewrites. The idea is right and the tests are thorough.

### 335-1 (medium) The CSRF Origin guard still keys on the raw path, so a locale prefix skips it

`apps/web/middleware.ts`, the SEC-WEB-01 block (around line 203 on the branch): `path.startsWith("/api/v1/")` and `isCsrfExemptPath(path)` use `path`, not `routePath`. Everything after that block uses `routePath`.

What happens: a `POST /es/api/v1/register-interest` on `play.tournamental.com` in hub mode is not an `/api/v1/` path to the guard, so no Origin check runs. `routePath` is `/api/v1/register-interest`, which is in `HUB_ALLOWED_PREFIXES`, so the request reaches `withLocaleHint()`, whose locale branch rewrites it to `/api/v1/register-interest` with the method and body intact. A Next middleware rewrite does not run the middleware again, so the route handler executes with no Origin check. On `main` the same request was bounced to the archive with a 302 (the hub allow list matched on `path`), so this PR opens the path on the hub host.

On the hub the practical damage is small, because register-interest is unauthenticated and anyone can already POST to it from a script; the only thing a cross-site page gains is the visitor's IP for the rate-limit bucket. In live mode it is the real SEC-WEB-01 hole: `POST /es/api/v1/syndicates` from an attacker page carries the `tnm_session` cookie (`SameSite=None`) and skips the Origin check. That hole exists on `main` today as well, because `withLocaleHint()` has rewritten locale-prefixed API paths since May, but this PR is the one that introduces the stripped path and should close it.

Smallest fix: use `routePath` in the guard.

```ts
if (
  routePath.startsWith("/api/v1/") &&
  MUTATING_METHODS.has(req.method) &&
  !isCsrfExemptPath(routePath)
) {
```

Add to `middleware-host-modes.test.ts`: `run(PLAY, "/es/api/v1/register-interest", { method: "POST" })` is 403 `bad_origin`, and the same for the archive host.

### 335-2 (low) The invite redirect drops the locale the comment says it keeps

`routePathOf()` doc comment: "Redirect targets keep the original path so the visitor's locale survives the hop." The archive block-list redirect and the hub fall-through redirect do keep `path`, but the invite redirect builds `new URL(\`https://${host}/\`)`, so `/es/i/abcd` lands on `/?ref=abcd` with no prefix and no `vt_locale` cookie (the redirect returns before `withLocaleHint()`). A Spanish visitor following a shared Spanish invite link gets the English hub unless the cookie is already set. The test "recognises invite links under a locale prefix" pins this behaviour. Fix: when the prefix is present, redirect to `https://${host}/${prefix}/?ref=...` (the `/es` root already rewrites to `/hub` on this branch).

### 335-3 (low) Two copies of the prefix strip

`routePathOf()` and the locale branch of `withLocaleHint()` compute the same thing. They agree today, including on case (both use `isSupportedLocale`, which is case sensitive, so `/ES/pools` is neither stripped nor blocked and falls through to a 404). Have `withLocaleHint()` call `routePathOf()` so they cannot drift.

Checked and sound: block list matches by whole segment (`/poolsy` served, `/pools/new` blocked); `/es` on the archive rewrites to `/archive` and on the hub to `/hub` through the new `rewriteTo ?? ...` line; query strings survive both rewrites and redirects; archive 403 on mutating methods runs before any path logic so a locale prefix cannot reach a write on the archive host; HEAD is served; alias hosts 301 with path and query; `play.localhost` and `fwc2026.localhost` behave like their production hosts.

## PR #336: `review/register-interest-security`

Files: `apps/web/app/api/v1/register-interest/route.ts`, `apps/web/lib/register-interest/store.ts`, `apps/web/middleware.ts` (`ARCHIVE_BLOCKED_API`), `.gitignore`, tests under `apps/web/__tests__/register-interest/`, `docs/reviews/2026-10-register-interest.md`.

The store change (RI-02, RI-03) is correct and the tests cover the two abuse cases. The response no longer leaks `created`. Country is validated before truncation. The invite code generator uses rejection sampling with the right threshold (248). `.gitignore` patterns match the two stray backups and leave `.env.example` alone.

### 336-1 (medium) RI-07 is bypassed by a locale prefix

`apps/web/middleware.ts` line 230 on the branch: `ARCHIVE_BLOCKED_API.some((re) => re.test(path))` tests the raw path. `GET /es/api/v1/syndicates/<slug>/join-requests/<user>/approve?t=<token>` on `fwc2026.tournamental.com` does not match the regex, is not in `ARCHIVE_BLOCKED_PREFIXES`, and reaches `withLocaleHint()`, which rewrites it to `/api/v1/syndicates/<slug>/join-requests/<user>/approve` and the handler at `apps/web/app/api/v1/syndicates/[slug]/join-requests/[userId]/approve/route.ts` flips the membership row. Only a holder of a valid signed token (the pool owner from the email) can do this, so the exposure is a post-archive write by an owner, not by a stranger. The review doc marks RI-07 "Fixed"; it is fixed for un-prefixed paths only.

Smallest fix: test the locale-stripped path. Once #335 lands this is `re.test(routePath)`; until then strip the prefix inline the same way. Add `"/es/api/v1/syndicates/mates/join-requests/u_1/approve?t=abc"` to the `it.each` in `middleware-archive-api.test.ts`.

### 336-2 (low) The 8 KB body cap measures UTF-16 code units, not bytes

`route.ts` lines 99 to 102: `raw.length > MAX_BODY_BYTES`. A body of 8,000 three-byte characters is 24 KB on the wire and passes. With a chunked request (no `Content-Length`) the whole body is still read into memory before the check. The runtime is `nodejs`, so `Buffer.byteLength(raw) > MAX_BODY_BYTES` is a one-line fix; a true streaming cap needs `req.body` with a byte counter and is not worth it here.

### 336-3 (low) A repeat submit can no longer correct anything, and the form does not say so

RI-02 is the right call for an unauthenticated form, but the product effect is that a person who registered without a phone, or with a typo in their name, cannot fix it: the thank-you state shows as if the new details were saved, and HighLevel is not updated once synced. Either say so in the thank-you copy or note it in the privacy wording. Also note that a repeat submit from anyone who knows the email still triggers a HighLevel upsert attempt whenever `ghl_status` is not `synced`; it re-sends the stored row, so nothing new leaks, but it is a free way to make the app call HighLevel.

### 336-4 (low) `deleteRegisterInterest` has no caller

It is exported from `store.ts` and tested, but no route, script or runbook uses it. Privacy requests still mean opening game.db by hand. A tiny `apps/web/scripts/register-interest-delete.ts` (or a line in the DSAR runbook) would make the helper real.

### 336-5 (low) `hashIp` falls back to a constant salt

Pre-existing and called out by the author: if `TOURNAMENTAL_INTERNAL_SECRET` is unset the IP hash is brute-forceable for IPv4. Whether it is set in the production unit is unconfirmed from the repo. Consider refusing to hash (store `null`) when the secret is missing rather than hashing with `"tournamental"`.

Checked and sound: the Origin guard runs before the archive 403 so an archive POST without Origin gets `bad_origin` and with a first-party Origin gets `archived`, both 403; honeypot returns a fake success with an empty code and stores nothing; `source_path` must match `^\/[A-Za-z0-9/_.-]{0,119}$`; `ref` must exist as an invite code and is set at creation only; first-touch attribution means self-referral is impossible (the code does not exist before the row); errors carry `Cache-Control: no-store`; the GHL module is mocked and global `fetch` throws in the tests so nothing reaches the network.

## PR #343: `feat/archive-r32-results` (stacked on `test/archive-standings-fixtures`)

Files: `apps/web/lib/archive/final-standings.ts`, `apps/web/app/archive/page.tsx`, the standings test. Diff against the stacked base is small: `KNOCKOUT_STAGE_ORDER` and `KNOCKOUT_STAGE_LABEL` move into the loader module with `r32` added, and the SQL filter adds `match_id LIKE 'r32%'`. Merge the base branch first (or rebase).

### 343-1 (medium, unconfirmed on live data) The final is only listed if its stored outcome carries `stage: "f"`

`final-standings.ts` line 145: `stage: String(o.stage ?? r.match_id.split("_")[0])`. The fixture id for the final is `final` (`packages/bracket-engine/data/fifa-wc-2026-fixtures.json` line 1307), so the fallback gives `"final"`, which is not in `KNOCKOUT_STAGE_ORDER` (`"f"`). The page filters `KNOCKOUT_STAGE_ORDER.filter((s) => byStage.has(s))`, so a final whose outcome JSON has no `stage` silently vanishes from "Road to the final". The results poller (`infra/scripts/results-poller.sh` line 286) sends the fixture's stage, which is `f`, so the production row is probably fine; a hand-settled final is not. The test file shows the ambiguity: one test asserts `stage: "final"` for a row that carried that value, another seeds `stage: "f"` so the page-order check passes. This PR exists to stop the list and the loader drifting; this is the remaining drift.

Smallest fix in the loader, plus a test that a `final` row with no `stage` lands under `f`:

```ts
const rawStage = String(o.stage ?? r.match_id.split("_")[0]);
const stage = rawStage === "final" ? "f" : rawStage;
```

### 343-2 (low, pre-existing, unconfirmed on live data) The third-place play-off may be missing for a different reason

The fixture id is `tp_01` with stage `tp`, and the poller posts that stage, but the game service schema (`apps/game/src/schemas.ts` line 142) only accepts `group, r32, r16, qf, sf, f`, so the poller's POST for `tp_01` would have been rejected with 400. If the result was never recorded by hand, the "Third place" heading never renders. Not this PR's bug; worth a look at the production `match_results` row before the archive is promoted.

### 343-3 (low, pre-existing) `method` is never written, so "aet" and "pens" never show

`MatchOutcome` in `apps/game/src/types.ts` has no `method` field and `routes/match.ts` does not write one, so the page's ` aet` / ` pens` suffix (and `knockoutScoreText` in #348) is dead. The final shows as "1-0", not "1-0 aet". The note "Winners shown with the final score" is still true. Either drop the suffix code or add `method` to the settle schema later.

### 343-4 (low) Order inside a stage is by `recorded_at`, not by match number

`ORDER BY recorded_at ASC` means the sixteen round-of-32 rows appear in settle order (`r32_14` before `r32_01` if that is when the poller ran). Cosmetic; `ORDER BY match_id` within the stage would be more stable for a static archive.

Checked and sound: `LIKE 'r32%'` cannot match group ids (they are plain numbers); the loader opens the database read-only and closes it in `finally`; missing file and missing table both return `[]`; the page imports resolve on the branch.

## PR #345: `feat/web-security-headers`

Files: `apps/web/lib/security/headers.mjs`, `apps/web/next.config.mjs`, `apps/web/__tests__/platform/security-headers.test.ts`.

The structure is good: one plain ESM module feeds both `next.config.mjs` and the tests, the CSP is report-only, and `nosniff` is safe because every non-HTML surface sets its type (`embed/widget.js/route.ts` line 875 `application/javascript`, the OG routes `image/png`, `sw.js` and the manifest from `public/`).

### 345-1 (high) `frame-ancestors 'none'` on everything except `/embed/*` and `?embed=1` blanks every in-iframe click inside the partner embed

What the embed does: `apps/web/app/embed/widget.js/route.ts` lines 344 and 566 build an iframe to `/world-cup-2026?embed=1&pool=<slug>` on `play.tournamental.com`, loaded from partner origins.

On the live hosts today (hub mode): the middleware sends that URL to `https://fwc2026.tournamental.com/world-cup-2026?embed=1&pool=...` with a 302. The archive branch of `apps/web/app/world-cup-2026/page.tsx` (lines 81 to 89) ignores `embed` and renders the full `AppShell`: app bar, archive banner with its "What's next" link, bottom nav, footer links, and the results bracket. Today a visitor on a partner site can click those links inside the iframe and the archive pages render (with chrome, but they work). After this PR every one of those targets (`/`, `/players`, `/world-cup-2026/calendar`, `/bot-arena`, `/languages`) responds with `X-Frame-Options: DENY` and `frame-ancestors 'none'`, and the iframe shows the browser's "refused to connect" page.

In live mode later: the bracket builder's own in-frame navigations drop `?embed=1`. `components/bracket/LockSummary.tsx` line 166 does `window.location.href = "/world-cup-2026/save-share"` after a lock-in; `BracketBuilder.tsx` lines 1893 to 1919 link to `/world-cup-2026/save-share` and `/profile`; `KnockoutMatch.tsx` links to `/team/<id>`; `MatchVenueFooter.tsx` to `/match/<id>/preview`. The lock-in flow inside a partner embed would end on a blank frame. (`grep -i embed` over `components/bracket` finds no embed awareness, so none of these preserve the query.)

Three ways out, smallest first:

1. Exempt the archive host from the framing rule, since the middleware already refuses every write there and clickjacking has nothing to click. Next `has`/`missing` support `type: "host"`; add `{ type: "host", value: "fwc2026\\.tournamental\\.com" }` to the `missing` list of the exclusive rule (entries in `missing` are ANDed, so the rule then applies only when the request is neither the embed nor the archive host). That fixes the live hosts today.
2. For live mode, make the embed carry its state: propagate `?embed=1` on in-frame links and the `save-share` redirect, or give those links `target="_top"`. This is a separate PR and must land before the framing rule is enforced in live mode.
3. Alternatively narrow DENY to the surfaces that have something to clickjack (`/auth`, `/profile`, `/manage`, `/dashboard`, `/pools`, `/syndicates`, `/import`, `/run`, `/bots`, `/predict`, `/hub`, `/api`) with one `source: "/<prefix>/:rest*"` rule each. Note that the headers phase sees the original URL, so locale-prefixed versions (`/es/manage`) would then need their own rule; the current catch-all does not have that problem.

Hold the PR until option 1 (at least) is in and the live-mode plan is written down.

### 345-2 (medium) The report-only CSP omits the Telegram login widget, and the hosts where it would be watched never load it

`app/auth/TelegramLogin.tsx` line 81, `components/auth/SignupModal.tsx` line 335 and `components/auth/LinkTelegramButton.tsx` line 87 inject `https://telegram.org/js/telegram-widget.js`, which then opens an iframe on `https://oauth.telegram.org`. Neither origin is in `script-src` or `frame-src`. Nothing breaks now because the policy is report-only, but the plan in the module header ("watch the browser console on the hub and the archive for a week, then promote") would never see the violation: `/auth` is blocked on the archive and not allow-listed on the hub. Promoting as is would break Telegram sign-in on the first live day. Add both origins now, and watch live mode before enforcing.

### 345-3 (low) The comment on rule merging is backwards

`securityHeaderRules()`: "later values do not override earlier ones for the same key". The Next docs say the opposite: when two rules match the same path and set the same header key, the last one wins. It does not matter here because the two rules set disjoint keys, but the comment will mislead the next editor who adds a third rule.

### 345-4 (low, unconfirmed) The exclusive `source` is not compiled through Next in the tests

`source: "/:path((?!embed(?:/|$)).*)"`. path-to-regexp 6 (what Next 14.2 bundles) allows `(?` groups inside a parameter pattern and rejects only capturing groups, and `.*` may match the empty string, so `/` should match and get the framing headers. The test at `security-headers.test.ts` lines 137 to 143 builds its own `RegExp` from the source rather than compiling with Next, so this is reasoned, not verified. After the staging build, confirm with `curl -sI` on `/`, `/embed/widget.js`, `/world-cup-2026?embed=1` and `/embedded` on each host.

### 345-5 (low) A ~700 byte header on every response, including immutable chunks and OG PNGs

`{ source: "/:path*" }` adds `Content-Security-Policy-Report-Only` to `_next/static/*`, `/api/*` JSON, the OG images and `sw.js`. With no `report-to`, it does nothing on non-HTML responses and costs bytes on the hottest paths (CLAUDE.md asks for performance to be reviewed on every PR). Exclude `_next/static` and `/api/` from the CSP rule, or accept the cost and say so in the session note.

### 345-6 (low, unconfirmed) HSTS is assumed to be set at the Cloudflare zone

`docs/33-security-hardening-checklist.md` line 12 still lists HSTS as unchecked. I cannot see the zone. One `curl -sI https://play.tournamental.com | grep -i strict` settles it; if absent, add it in Cloudflare rather than here, as the module says.

### 345-7 (low) Nothing else in the policies bites

`Permissions-Policy` denies camera, microphone, geolocation, payment and USB: a grep of `apps/web/app`, `components`, `lib` and `public` finds no use of any of them (the "camera" hits are the three.js rig). `navigator.share` and the clipboard are not governed, and the widget's `allow="clipboard-write *; fullscreen *"` is unaffected. `Referrer-Policy: strict-origin-when-cross-origin` is the modern browser default and no server code reads `Referer` (the CSRF guard uses `Origin`). `font-src 'self' data:` is enough: fonts come from `/fonts/`, no Google Fonts. `connect-src` covers the first-party services and GTM; `img-src https:` is broad but safe. The headers phase runs before middleware, so `/` on each host gets the framing headers even though it is rewritten to `/hub` or `/archive`.

## PR #348: `fix/a11y-hub-archive-shell`

Files: `components/shell/AppMenuDrawer.tsx`, `app/hub/RegisterInterestForm.tsx`, `components/ui/CountdownBanner.tsx`, `components/shell/BottomNav.tsx`, `components/shell/AppShell.tsx`, `app/archive/page.tsx`, `lib/archive/labels.ts`, `app/globals.css`.

Good changes throughout: the dialog role moves from the backdrop to the panel; focus goes to the close button on open and back to the opener on close, guarded by `document.contains`; the thank-you heading takes focus; the honeypot is inside an `aria-hidden` wrapper with the `.vt-hub-hp` class still applied (the CSS selector is class-based, so moving it from the label to the div still hides it); `aria-describedby` only points at ids that exist in that render; the flag emoji is hidden from AT; the knockout link names start with the visible word "Match" so WCAG 2.5.3 holds; `aria-expanded` is wired from `AppShell`.

### 348-1 (medium) Merge conflict with #343 in `apps/web/app/archive/page.tsx`

Confirmed with `git merge-tree`: #343 replaces the page-local `STAGE_LABEL` with `KNOCKOUT_STAGE_LABEL` from the loader, #348 reads `STAGE_LABEL[s] ?? s` inside the new `aria-label`. Whichever lands second must change the `aria-label` call to `knockoutLinkLabel(KNOCKOUT_STAGE_LABEL[s] ?? s, teamName(k.winner), k)`. Not a code bug, a merge task; if #343 goes first the conflict is one line.

### 348-2 (low) The drawer effect re-runs on every `AppShell` render because `onClose` is a fresh arrow

`AppShell.tsx` line 185 passes `onClose={() => setMenuOpen(false)}`; `handleEsc` is `useCallback(..., [onClose])`; the effect depends on `[open, handleEsc]`. Any re-render of `AppShell` while the drawer is open runs the cleanup (focus to the opener, scroll unlocked) and then the setup (focus to the close button), so a keyboard user part-way down the menu loses their place. Today `AppShell` only re-renders on the menu toggle itself, so this is latent, but it is one state hook away from biting. Fix: keep `onClose` in a ref, or put the focus and trap logic in a second effect keyed on `[open]` only.

### 348-3 (low) The trap does not catch focus that is already outside the panel

`trap` only acts when `document.activeElement` is the first or last focusable. If focus is on `document.body` (after a click on a non-focusable part of the panel) Tab goes to the first focusable in the document, which is the app bar behind the dialog. Add: if `!panelRef.current.contains(document.activeElement)`, `preventDefault()` and focus `first`.

### 348-4 (low) Double announcement on copy

The new `<span aria-live="polite">Invite link copied</span>` sits inside a container that is itself `role="status" aria-live="polite"`, and the button text changes to "Copied" at the same time. Some screen readers will say both. Keep one: drop the inner span and rely on the button text, or move the span outside the status container.

### 348-5 (low) The countdown label reads "Kicked off" before hydration

`CountdownBanner.tsx` seeds `now` with `targetMs` for a deterministic first render, so `parts.elapsed` is true until the effect runs and `aria-label` is `pastLabel` ("Kicked off" on the hub) for the server HTML and first paint. The visible eyebrow has had the same quirk since June; the new label just gives it a voice. Fix: when `now === targetMs` use a neutral `Countdown to ${title}`.

### 348-6 (low) `summaryFor` spells out English short labels only

`Days`, `Hrs`, `Min` become words; a translated label is read as given ("3 Std"). Acceptable, just note it in the component comment so nobody files it as a bug.

Checked and sound: `role="timer"` with `aria-label` and an `aria-hidden` grid is the right pattern for a ticking clock; `aria-busy` on the submit button; `fieldFor()` maps the three field errors and returns null for the rest; the honeypot field name is unchanged so #336's `body.website` check still works; `BottomNav` without `menuOpen` reports `aria-expanded="false"`, which is correct for its only caller.

## Interactions between the PRs

- #335 and #336 merge cleanly (`git merge-tree` reports no conflict) but share one bug shape: #336's `ARCHIVE_BLOCKED_API` and the pre-existing CSRF guard both test the raw `path`, while #335 moves everything else to `routePath`. After both land, `/es/...` still skips the Origin guard (335-1) and the archive GET block (336-1). One fix covers both: use `routePath` in those two checks and add the two locale-prefixed cases to each test file.
- #343 and #348 conflict in `apps/web/app/archive/page.tsx` (348-1). #348's `knockoutScoreText` duplicates the score formatting that #343 leaves in place; after the merge the page should use `labels.ts` for both the visible score and the link name, which is what #348 already does.
- #345 with the middleware PRs: Next evaluates `headers()` against the original request URL before middleware, so `/` and `/es` on every host receive the framing headers although they are rewritten to `/hub` or `/archive`. The hub's 302 of the embed URL to the archive host is unaffected; it is the archive host that then serves the framed page, which is why 345-1 matters today and not only in live mode.
- #345 with #336: the register-interest JSON response gains the report-only CSP header. Harmless.
- #348 with #336: the form change is markup only; the request payload and the honeypot field name are unchanged.

## What was checked and found sound

- #335: segment-wise block matching, `/es` root rewrites in both modes, query preservation, legal redirects under a prefix, archive 403 on writes regardless of prefix, alias 301s, `localhost` variants, no mode applied to `tournamental.com` or the dev origin.
- #336: first-touch attribution, consent only raised, invite code rejection sampling (threshold 248 = 8 x 31), `created` removed from the response, country validated before truncation, `source_path` regex, honeypot fake success, `.gitignore` patterns, tests isolated from the network.
- #343: `r32` filter and labels, read-only database access with `finally` close, empty results on missing file or missing table, group ids cannot match the `LIKE` filters.
- #345: `nosniff` safe for `widget.js`, OG images, `sw.js` and the manifest; `Permissions-Policy` denies nothing the app uses; `Referrer-Policy` matches the browser default and no server code reads `Referer`; CSP is report-only and covers GTM, blob workers, first-party fetch origins and the stream WebSocket; headers applied before middleware rewrites.
- #348: dialog semantics, focus order on open and close, honeypot still hidden and untabbable, `aria-describedby` targets exist, visible link text retained in the accessible name, `aria-expanded` wiring, `aria-busy` on submit.

## Status after fixes, 20 October (same day)

Applied on the branches as one commit each, with a test, after this review was written. The findings above describe the branches before these commits.

| Finding | Commit on | What changed | Test |
| --- | --- | --- | --- |
| 335-1 | `test/archive-middleware-host-modes` (#335) | Origin guard keys on `routePath` | three cases in `middleware-host-modes.test.ts`; platform folder 86 pass |
| 336-1 | `review/register-interest-security` (#336) | `ARCHIVE_BLOCKED_API` tested on the locale-stripped path | two prefixed paths in `middleware-archive-api.test.ts`; 9 pass |
| 343-1 | `feat/archive-r32-results` (#343) | loader maps a `final` id to stage `f` | new case in `final-standings.test.ts`; archive folder 30 pass |
| 345-1, 345-2, 345-3 | `feat/web-security-headers` (#345) | archive hosts exempt from the framing rule via a `missing` host condition; Telegram origins in `script-src` and `frame-src`; precedence comment corrected | two cases in `security-headers.test.ts`; 17 pass |
| 348-2 to 348-5 | `fix/a11y-hub-archive-shell` (#348) | `onClose` in a ref so the effect depends on `open` only; Tab from outside the panel returns to its first control; one copy announcement through the button name; neutral countdown label before hydration | one case in `AppMenuDrawer.a11y.test.tsx`; a11y folder 22 pass |

Later the same day: 336-2 (byte cap counts UTF-8 bytes) and 336-5 (one-time warning when the ip hash salt is the default) on #336; 343-4 (each stage in match id order) on #343; 343-2 (`tp` accepted by the settlement schema and the stored outcome type) and 343-3 (`method` carried through settlement) on the new PR #360. The three failing cases in `apps/game/tests/match-result.test.ts` that 343-2 mentioned fail on `main` for the clock reason and are fixed in PR #361.

Left as they were: 335-2, 335-3, 336-3, 336-4, 345-4 to 345-7, 348-1 (the conflict, resolved at merge time per the merge-order paper) and 348-6. The hold on #345 becomes "merge with the live-mode embed plan agreed": in-frame links inside the partner embed need `target="_top"` or to carry `?embed=1` before the framing rule is enforced on the live host.
