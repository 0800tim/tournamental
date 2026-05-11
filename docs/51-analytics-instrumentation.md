# 51 — Analytics instrumentation

> The Tournamental GA4 + GTM tracking layer. This doc covers the event
> taxonomy, the user-property taxonomy, the consent model, how to add a
> new event, and how to debug it locally.

## Architecture in one paragraph

We push events to `window.dataLayer`. Google Tag Manager forwards them
to GA4. Every event is namespaced `tournamental.*` so the GTM container
can use a single trigger (`event matches RegEx ^tournamental\\.`) to
forward everything. The wrapper is in `apps/web/lib/analytics/`; an
Astro sibling exposes `window.tournamental.track()` for the marketing
site. When `NEXT_PUBLIC_GTM_ID` / `PUBLIC_GTM_ID` is unset, every
`track()` call is a silent no-op — local dev and production keep
working while Tim's container ID is still pending (see
[26-setup-checklist.md](26-setup-checklist.md) § 2.2).

Server-side eventing into `vtorn-api`'s `/v1/event` endpoint is
described separately in [23-analytics-and-marketing-insights.md](23-analytics-and-marketing-insights.md).
This doc covers the **client** side only.

## Event taxonomy

| Event name                       | When fired                                                                  | Payload fields                                                                       |
| -------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `page.view`                      | Every client-side route change (auto, via `usePageView`)                    | `path`, `title`, `host`, `referrer`                                                  |
| `bracket.pick.saved`             | Any pick committed to the bracket draft (BracketBuilder `update()`)         | `tournament_id`, `match_predictions`, `knockout_predictions`, `tiebreakers`           |
| `bracket.bracket.saved`          | Final submission via `submitBracket` resolves                                | `tournament_id`, `bracket_id?`, `result` (`ok`/`draft_only`/`error`), `error?`        |
| `bracket.share.opened`           | Share CTA tapped                                                            | `tournament_id`, `surface`                                                            |
| `bracket.share.completed`        | *(deferred — share-card agent owns the modal; wire on merge)*               | `channel`, `tournament_id`, `bracket_id`                                              |
| `bracket.autopick.run`           | Auto-pick CTA confirmed                                                     | `tournament_id`                                                                       |
| `match.opened`                   | `/match/[id]` mount                                                         | `match_id`, `source`                                                                  |
| `match.cam.angle.changed`        | *(deferred — Director / CameraRig agent territory; add when stable hook)*   | `match_id`, `from`, `to`                                                              |
| `molecule.opened`                | `/world-cup-2026/molecule` mount                                            | (none)                                                                                |
| `molecule.team.clicked`          | *(deferred — molecule-v3 agent is rewriting `<MoleculeScene/>`; sweep PR)*  | `team_code`                                                                           |
| `molecule.consensus.toggled`     | *(deferred — same as above)*                                                | `enabled`                                                                             |
| `signup.started`                 | *(deferred — registration agent owns the modal; add in the signup modal)*   | `surface`                                                                             |
| `signup.completed`               | *(deferred — call from registration `useEffect` on success)*                | `auth_method`, `user_id_hashed` (already hashed)                                      |
| `signup.step.skipped`            | *(deferred — Skip click handler in the registration modal)*                 | `step`                                                                                |
| `profile.field.updated`          | *(deferred — registration agent's profile form `onBlur` handler)*           | `field`                                                                               |
| `profile.exported`               | *(deferred — profile export button)*                                        | `format`                                                                              |
| `profile.deleted`                | *(deferred — profile delete-account confirm)*                               | (none)                                                                                |
| `auth.signin.opened`             | *(deferred — registration agent's sign-in modal mount)*                     | `surface`                                                                             |
| `auth.signin.completed`          | *(deferred — registration agent's sign-in success)*                         | `auth_method`                                                                         |
| `nav.menu.opened`                | Mobile drawer open via the BottomNav Menu tab                                | `surface`                                                                             |
| `nav.tab.changed`                | BottomNav tab tapped                                                        | `label`, `href`, `surface`                                                            |
| `consent.changed`                | Consent banner decision or programmatic `setConsent()` call                  | `analytics_storage`, `ad_storage`                                                     |
| `cta.clicked`                    | Marketing CTA (auto-instrumented by `data-analytics="cta"`)                  | `label`, `href`, `surface`                                                            |
| `blog.post.opened`               | Marketing blog post mount                                                   | `slug`, `title`                                                                       |

### Deferred events (sweep PRs after sister agents merge)

Some call sites belong to other agents' branches. The taxonomy above
marks them `(deferred)`; the events are already in the union type so
adding them later is a one-line change at the call site.

| Event                          | Owning branch                              | Where the call site goes (approx)                                                       |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `signup.started/completed/skipped` | `feat/user-registration-and-profiles`  | `apps/web/components/auth/SignupModal.tsx` mount / submit / skip handlers               |
| `profile.field.updated`        | `feat/user-registration-and-profiles`     | `apps/web/app/profile/page.tsx` form `onBlur`                                            |
| `profile.exported/deleted`     | `feat/user-registration-and-profiles`     | profile page action handlers                                                             |
| `auth.signin.*`                | `feat/user-registration-and-profiles`     | sign-in modal mount + success                                                            |
| `molecule.team.clicked`        | `feat/molecule-v3-pyramid`                | `<MoleculeScene/>` `onSelect(code)` callback                                             |
| `molecule.consensus.toggled`   | `feat/molecule-v3-pyramid`                | molecule consensus toggle handler                                                        |
| `match.cam.angle.changed`      | various match-renderer branches            | `Director` / `CameraRig` angle-change branch                                             |
| `bracket.share.completed`      | `feat/share-card-and-viral-loop`          | once the share modal lands, fire on each channel click                                  |

### Common conventions

- **Past tense for completed actions** (`.saved`, `.completed`), present
  tense for things that just opened (`.opened`).
- **No PII**: never put raw email / phone / IP / uuid in a payload.
  User identifiers are pre-hashed via `identifyUser()`.
- **Primitive payload values only**: string / number / boolean / null.
  GA4 silently drops complex types.

## User-properties taxonomy

Set once per session via `setUserProperties()`. GA4 surfaces every
metric pivoted by these dimensions in Looker Studio.

| Property             | Type                       | Source                                                                                     |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `country_code`       | ISO-2 string               | Server, from Cloudflare `CF-IPCountry`                                                     |
| `engagement_band`    | `"cold" / "warm" / "hot"`  | Server engagement scorer                                                                   |
| `bracket_completion` | number (0–104)             | Client; count of `matchPredictions + knockoutPredictions`                                  |
| `is_pundit`          | boolean                    | `/v1/users/me.pundit_status === "verified"`                                                |
| `visit_count`        | number                     | Server; increments on session start                                                        |
| `age_bucket`         | string (e.g. `25-34`)      | Profile (only if user provided)                                                             |
| `auth_method`        | string (`telegram/email/x`)| Last sign-in method                                                                        |

## Consent model

GA4 consent-mode v2. Four independent flags:

- `analytics_storage` — defaults **granted** (product analytics are
  essential to product safety).
- `ad_storage` — defaults **denied** (no ad-targeting until the user
  accepts).
- `ad_user_data` — defaults **denied**.
- `ad_personalization` — defaults **denied**.

A first-visit banner (`<ConsentBanner/>`) prompts the user. Two
options:

- **Accept** → all four flags `granted`.
- **Only essential** → analytics_storage granted, all `ad_*` denied.

Decision persists in `localStorage["tournamental.consent.v1"]` and is
re-applied on every subsequent visit (the SDK re-pushes the
`consent_update` envelope so GTM's current state is in sync).

Region-aware rules (GDPR / CCPA) are a v2 add — for v1 we show the
banner globally; better safe than sorry.

## Adding a new event

Three steps:

1. Add the name to the `EventName` union in
   `apps/web/lib/analytics/index.ts`. The build will then refuse any
   call site that uses an unknown name.
2. Add a row to the table above.
3. Call `track("the.new.event", { … })` at the right point.

If the event lives in another agent's branch, add the name to the
union now and document the deferred call site here — that way the
type surface is locked even before the call site lands.

## Debugging locally

```js
// In any browser console:
localStorage.tournamental_analytics_debug = "1";
```

From the next call onward, every push is mirrored to `console.debug`
with the full envelope. Clear it with
`delete localStorage.tournamental_analytics_debug` or by removing the
key in DevTools.

To confirm GTM is loaded: `window.dataLayer` should be a non-empty
array; the first entry is `{ "gtm.start": <number>, event: "gtm.js" }`.

## Where it lives

```
apps/web/lib/analytics/
  index.ts                 ← track / setUserProperties / setConsent / identifyUser
  usePageView.ts           ← App Router page-view hook

apps/web/components/analytics/
  GtmRoot.tsx              ← <Script> injector + consent banner mount
  PageViewListener.tsx     ← hosts usePageView()
  ConsentBanner.tsx        ← first-visit consent banner
  RouteEvent.tsx           ← drop-in for server-component pages

apps/marketing/src/components/
  Analytics.astro          ← head-side GTM + window.tournamental.track
  AnalyticsNoScript.astro  ← <body>-side <noscript> iframe fallback
```

## Tim's bar (acceptance test)

> Every meaningful user action shows up in GA4 within 24 hours of
> pasting the real `GTM-XXXXXXX` into `.env.production`.

Day-1 events covered: page-view, nav tab change, mobile menu open,
bracket pick saved, bracket auto-pick run, bracket bracket saved,
bracket share opened, match opened, molecule opened, consent changed,
marketing CTA click, blog post opened.

Deferred (waiting on sister-agent merges, will be a one-line sweep
each): the signup / profile / auth / molecule-detail / cam-angle /
share-completed call sites listed above.
