# 44 — Overlay Router and Mobile Overlays

> Tim's directive (2026-05-11): the bracket should feel **card-style** on
> mobile — tap a team, the team card overlays the bracket; tap close /
> drag down / browser back to return where you were. Every overlay must
> still have a **deep-linkable URL** so it's shareable, SEO-indexable,
> and bookmarkable.

This doc describes the overlay system that ships in `apps/web`
(branch: `feat/mobile-overlays-deep-links`, PR: #TBD) and the
companion mobile-drawer polish for `apps/marketing`.

## Why a custom overlay system

Off-the-shelf modal libraries (Headless UI, Radix Dialog, Framer
parallel-routes) all couple "this is a modal" with "this is a separate
React subtree, opened imperatively." We need three things they don't
give us together:

1. **URL-as-state**: the open overlay is encoded in `?overlay=...` so
   `https://2026wc.vtourn.com/world-cup-2026?overlay=team&code=NZL` is
   shareable and re-renders the same view on cold load.
2. **Underlying-route preservation**: the page route must NOT change
   when an overlay opens — search engines + analytics still see
   `/world-cup-2026` as the canonical page.
3. **Browser back unwinds the stack first**, then leaves the page.
   Each `open()` pushes a `history.pushState` entry; `popstate`
   re-snaps the stack to whatever the URL says.

Plus we want a sheet-on-mobile / modal-on-desktop chrome that's small
enough to hand-roll without bringing in framer-motion.

## URL scheme

```
/world-cup-2026?overlay=<kind>[,<kind>...] &<param>=<value> ...
```

- `overlay` is a comma-separated stack of overlay **kinds**, leftmost
  first (bottom of the stack) → rightmost last (top of the stack).
- Each frame's params are flat keys on the same query-string. Param
  flattening means every frame sees every key — readers consume only
  the keys they know about.

Examples:

| URL                                                     | Stack on cold load              |
| ------------------------------------------------------- | ------------------------------- |
| `/world-cup-2026`                                       | empty                           |
| `/world-cup-2026?overlay=team&code=NZL`                 | `[{ team, code=NZL }]`          |
| `/world-cup-2026?overlay=team,match&code=NZL&id=55`     | `[{ team }, { match }]`         |
| `/world-cup-2026/share/abc123?overlay=leaderboard-entry&bracketId=abc123` | `[{ leaderboard-entry }]` |

Limitations (deliberate, simplifies the codec):

- Two stacked overlays of the same `kind` cannot have conflicting
  params on the URL. In practice the bracket UX never does this
  (tapping a second team replaces the first); the provider enforces
  this with replace-on-same-kind semantics.

## Components

| File                                          | Role                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `components/overlay/types.ts`                 | `OverlayKind`, `OverlayFrame`, `OverlayApi`                                                                       |
| `components/overlay/url.ts`                   | `parseOverlayUrl` / `encodeOverlayUrl` / `stacksEqual`                                                            |
| `components/overlay/OverlayProvider.tsx`      | React Context. Owns the stack, syncs with `history` and `location`, listens to `popstate`.                        |
| `components/overlay/Sheet.tsx`                | The visual chrome — bottom sheet on mobile, centred modal on desktop. Drag-to-close, Esc, backdrop click.         |
| `components/overlay/OverlayLink.tsx`          | `next/link` superset. Plain click → overlay; mod-click / middle-click → hard nav (escape hatch).                  |
| `components/overlay/OverlayRoot.tsx`          | Renders the stack via the kind→component registry. Mounted once per page.                                         |
| `components/overlay/OverlayBreadcrumb.tsx`    | Visible breadcrumb that mirrors the stack: "Page › Frame 1 › Frame 2".                                            |
| `components/overlay/BracketOverlayShell.tsx`  | Convenience client wrapper — provider + breadcrumb + root.                                                        |
| `components/overlay/OverlayServerShim.tsx`    | Server-rendered fallback for crawlers + screen readers.                                                           |
| `components/overlay/TeamOverlay.tsx`          | Team card content (`?overlay=team&code=...`)                                                                      |
| `components/overlay/MatchOverlay.tsx`         | Match preview card (`?overlay=match&id=...`)                                                                      |
| `components/overlay/LeaderboardEntryOverlay.tsx` | Placeholder for leaderboard-entry deep-links.                                                                |
| `components/overlay/overlay.css`              | Sheet chrome + body scroll-lock.                                                                                  |
| `components/overlay/team-overlay.css`         | Inner card content layout.                                                                                        |

## Public API

```ts
const overlay = useOverlay();
overlay.open("team", { code: "NZL" });   // push
overlay.replace("match", { id: "55" });  // replace top frame (no extra history entry)
overlay.close();                          // pop top
overlay.closeAll();                       // pop all
overlay.stack;                            // readonly snapshot
```

Use `useOptionalOverlay()` from components that may render outside an
`<OverlayProvider>` (e.g. on the marketing site or in tests). It
returns `null` when no provider is mounted; consumers should fall
through to plain navigation in that case.

## SEO + share-preview parity

Crawlers (Googlebot, Slack/Twitter unfurlers, Telegram instant view)
typically do not run JS. To keep deep-links indexable + shareable, the
page server-renders an `<OverlayServerShim>` block whenever the URL
contains an overlay query. The shim:

- Reads the page's `searchParams` server-side.
- Looks up the overlay's primary record (team / match / bracket).
- Renders a small `<aside>` with the overlay title + canonical link
  to the underlying real route (`/team/[code]`, `/match/[id]/preview`).
- Hides the shim visually (`position: absolute; left: -10000px`) so
  the client overlay is the foreground experience after hydration.

This is a deliberately small surface. The actual deep "team page" /
"match preview" content lives at the real routes; the shim is just an
HTML breadcrumb pointing crawlers there.

## Caching policy

Per `docs/22-deployment-and-tunnels.md`:

- **No cache split for overlay-bearing URLs.** The underlying page
  content doesn't change when an overlay is encoded; the shim adds at
  most ~200 bytes. We set `Cache-Control: public, s-maxage=300,
  stale-while-revalidate=86400` on the bracket page and let the same
  cache key serve both `/world-cup-2026` and
  `/world-cup-2026?overlay=team&code=NZL`. This relies on the CDN
  ignoring query strings for cache-key purposes (Cloudflare default
  for marketing pages), but the cost of *not* doing this would be a
  cache key per team × per match — explosion we don't want.

- **Browser-side**: the overlay system mutates `history.pushState`
  but never touches `Cache-Control`. The browser caches the same HTML
  document and re-renders client-side from the stored search-string.

Consequence: a deep-link from social will hit the same edge cache as
a clean visit. The shim's HTML payload IS in the cached response, so
shares of `?overlay=team&code=NZL` get the team-name preview straight
out of cache.

## Bracket integrations

`MatchPredictionRow` and `KnockoutMatch` were extended:

- The "View match" link now opens the **match overlay** on plain
  click (Cmd-click still hits the real `/match/[id]/preview`).
- A small "i" badge appears on each team's pick button when the
  bracket is wrapped in the overlay shell. Tapping it opens the
  **team overlay**. The badge is a plain `<a>` so right-click /
  Cmd-click still navigates to `/team/[code]` for a real-route view.

The pick functionality of the main button is unchanged — we did NOT
turn the flag tap itself into the overlay opener because that would
break the existing prediction UX. The "i" badge is the team-overlay
entry point, sized 18×18 in the corner of the pick button so it
doesn't compete with the pick tap target.

## Marketing site mobile drawer

Independent of the overlay system, the marketing site's mobile menu
was rewritten as a slide-in drawer:

- **Open**: hamburger tap → drawer slides in from the right
  (`width: min(85vw, 360px)`, full-height, scrim behind).
- **Close**: backdrop click, close-button tap, Escape key, or
  swipe-right (>64 px from initial touch).
- **Contents**: every nav link in the desktop header, plus the theme
  toggle, Contribute, For influencers, Legal, GitHub, and a
  "Play World Cup 2026" CTA pinned to the bottom.

Implementation in `apps/marketing/src/components/Header.astro` (markup +
script) and `apps/marketing/src/styles/globals.css` (`.vt-mobile-drawer`,
`.vt-mobile-scrim`).

## Tests

- `apps/web/__tests__/overlay-router.test.tsx` — 30+ unit tests across
  the URL codec, the provider state machine, the Sheet UI, and
  OverlayLink semantics.
- `apps/marketing/e2e/mobile-drawer.spec.ts` — Playwright spec
  exercising open / close / Escape / swipe-right / link-reachability.
  Gated on `RUN_MARKETING_E2E=1` (same as the existing readability
  spec).

## Performance budget

- Cold load with `?overlay=team&code=NZL` adds ≈ 1.2 KB gz to the
  page payload (the team-overlay component + the Sheet chrome). The
  data behind the overlay (`teams.json`, `fixtures.json`) is already
  loaded for the bracket itself.
- No additional network round-trip. Cmd-click → real route which has
  its own cache.
- Sheet animation is hand-rolled CSS, no framer-motion dependency.

## Future work

- Replace the bottom-sheet drag detection with a richer gesture
  state-machine (small horizontal-swipe-to-pop, content-scroll vs
  drag distinction). For 0.1 the simple Y-only gesture is enough.
- Wire BottomNav badge pulse when an overlay is open (parking until
  PR #106 merges and the BottomNav exists in main).
- LeaderboardEntryOverlay needs the actual share-preview integration
  once `apps/web/app/world-cup-2026/share/[bracketId]/page.tsx`
  ships its Verified-Pundit + share affordances.
- Optional: hash-based deep links (`#overlay=team`) for environments
  that prefer hashes over query strings (e.g. some PWA shells).
- Document a builder-agent recipe for adding a new overlay kind in
  three steps (add to `OverlayKind`, register in `OverlayRoot`,
  register in `OverlayServerShim`).
