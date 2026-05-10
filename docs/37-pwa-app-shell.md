# 37 — PWA app shell

> Status: shipped (PR `feat/web-pwa-app-shell`).
> Owner: shell-agent.
> Cross-refs: [doc 35](35-competitor-ux-dossier.md), [doc 36](36-tournamental-ux-spec.md), [doc 22](22-deployment-and-tunnels.md).

The web app's chrome is now an installable PWA shell that mirrors the FIFA Plus / FIFA World Cup 2026 app feel: top app-bar with avatar/title/action, pill tab nav, hero-card stacks, big countdown banner, fixture cards with flag-time-flag, and a thin bottom navigation bar with four icons (Home / Predict / Watch / Profile). On desktop (>=768px) the bottom nav is replaced with a 240px left side rail.

## Architecture

The shell is layered:

1. **`apps/web/components/shell/`** — chrome primitives. All `"use client"`.
   - `AppShell.tsx` — composer; renders `AppBar` + main + `BottomNav` (mobile) or `SideRailNav` (desktop) + `InstallPrompt` + `RegisterSW` + `ThemeMeta`.
   - `AppBar.tsx` — sticky 56px top bar, avatar / title / right-action.
   - `BottomNav.tsx` — fixed bottom 64px nav (mobile only). Hides on scroll-down, reveals on scroll-up. Honours `prefers-reduced-motion`.
   - `SideRailNav.tsx` — 240px fixed left rail (desktop only).
   - `PillTabs.tsx` — controlled or uncontrolled rounded-full tab strip.
   - `InstallPrompt.tsx` — once-per-device "Install Tournamental" toast hooked to `beforeinstallprompt`. iOS fallback shows the share-sheet hint.
   - `RegisterSW.tsx` — registers `/sw.js` post-mount in production. Opt-in for dev via `NEXT_PUBLIC_VTORN_SW_DEV=1`.
   - `ThemeMeta.tsx` — keeps `<meta name="theme-color">` in sync with `data-theme` on `<html>` and OS `prefers-color-scheme`.
   - `icons.tsx` — single source of truth for the 24px stroke icons used in the bottom nav, side rail, and app-bar action button.
   - `shell.css` — design tokens (CSS variables) + chrome layout. Light + dark via `[data-theme]`.

2. **`apps/web/components/ui/`** — design-language primitives used inside shelled pages.
   - `HeroCard.tsx` — image-backed gradient card with category pill + headline.
   - `CountdownBanner.tsx` — full-width band with days/hours/minutes/seconds. Ticks 1Hz (60Hz under reduced-motion).
   - `MatchCard.tsx` — fixture card. Same component renders pre-match (kickoff), live (running clock + score), and final (FT + score) states.
   - `PillChip.tsx` — small rounded chip with `neutral | accent | warm | pitch` tones.
   - `NewsCard.tsx` — image-left, headline-right card. Whole row is a tap target.
   - `StoriesStrip.tsx` — Instagram-style horizontal strip of 80px circular avatars with optional progress dashes.
   - `ui.css` — primitives' styling, sharing the same CSS variables as the shell.

3. **PWA assets** — installability + offline.
   - `apps/web/public/manifest.webmanifest` — name, icons (192/256/384/512 + maskable 192/512), `display: standalone`, theme + background colours, three shortcuts (Predict / Watch live / My picks).
   - `apps/web/public/sw.js` — service worker. Strategies:
     - cache-first for hashed static assets (`/_next/static`, `/icons`, `/flags`, `/animations`, `/models`)
     - network-first for `/api/`
     - stale-while-revalidate for everything else
     - shell-cache fallback for navigation requests (offline -> last-good shell HTML)
   - Background sync (`vt-bracket-sync`) queues failed bracket-draft writes in IndexedDB and replays them on `sync`.
   - Push-notification handlers (kickoff alerts) ready for `apps/push-notifications` to wire into.
   - `apps/web/scripts/generate-pwa-icons.ts` — emits the icon set from a single SVG mark via `@resvg/resvg-js`.

## Bottom-nav contract

Four primary destinations, in order:

| Tab     | Route             | Match prefix         | Icon stroke |
|---------|-------------------|----------------------|-------------|
| Home    | `/`               | exact `/`            | house       |
| Predict | `/world-cup-2026` | `/world-cup-2026`    | bracket cone|
| Watch   | `/watch`          | `/watch`             | screen+play |
| Profile | `/profile`        | `/profile`           | person      |

The optional fifth raised centre tab (Syndicates) is supported by `BottomNav` (`raised: true` prop) but disabled for v0.1.

The nav reads `window.location.pathname` (post-mount via `useEffect`) instead of `usePathname()` from `next/navigation` so static-prerendered pages (`force-static` team detail pages) don't trip the navigation context. A `popstate` listener keeps the active tab in sync with browser-history navigations.

## Adding a page that uses the shell

```tsx
// app/your-route/page.tsx
import { AppShell } from "@/components/shell";

export default function YourPage() {
  return (
    <AppShell title="Your section">
      <div className="vt-page-content">
        {/* page content */}
      </div>
    </AppShell>
  );
}
```

For pages with sub-tabs, pass a `subHeader` slot:

```tsx
<AppShell
  title="Leaderboard"
  subHeader={
    <PillTabs
      tabs={[{ id: "global", label: "Global" }, { id: "friends", label: "Friends" }]}
      active={tab}
      onChange={setTab}
      ariaLabel="Leaderboard scope"
    />
  }
>
  ...
</AppShell>
```

For full-bleed canvas pages (the renderer):

```tsx
<AppShell
  title="Match"
  variant="canvas"
  showBottomNav={false}
  showSideRail={false}
>
  <Canvas />
</AppShell>
```

## PWA install flow (user perspective)

1. Visit `/` (or any route) on Chrome, Edge, or Brave on Android / desktop.
2. After ~5s the "Install Tournamental" toast appears (once per device — dismissal stored in `localStorage` under `vt-install-dismissed-v1`).
3. Tap **Install**; the browser shows its install dialog; accept.
4. The app launches in standalone mode (no browser chrome) and the home-screen icon points to `/`.
5. Three home-screen shortcuts: Predict / Watch live / My picks.

On iOS Safari (which doesn't fire `beforeinstallprompt`), the toast falls back to a hint pointing the user at the share sheet's "Add to Home Screen" affordance after a 4s delay.

## Theming

`<html data-theme="dark">` (default) or `<html data-theme="light">` flips every shell + UI primitive via CSS variables. `ThemeMeta` updates `<meta name="theme-color">` to match (so the Android title-bar tints correctly). When `data-theme` is unset, the shell follows `prefers-color-scheme`.

Brand palette tokens live in `shell.css`:

| Token              | Dark             | Light             | Use                         |
|--------------------|------------------|-------------------|-----------------------------|
| `--vt-bg`          | `#0a0e1a`        | `#f5f7fc`         | page background             |
| `--vt-bg-elev`     | rgba(255,255,255,0.06) | rgba(10,14,26,0.05) | card surfaces       |
| `--vt-fg`          | `#e6edf3`        | `#0f1726`         | primary text                |
| `--vt-fg-muted`    | `#9aa6b6`        | `#4a5468`         | secondary text              |
| `--vt-accent`      | `#6cabdd`        | `#2071b8`         | sky-blue accent             |
| `--vt-accent-warm` | `#f3b83b`        | `#d97706`         | flame-orange accent         |
| `--vt-accent-pitch`| `#4cd680`        | `#16a34a`         | emerald-pitch accent        |

No new hues. Kit colours on team pages still come from each team's `kit.primary` / `kit.secondary` (per [doc 36](36-tournamental-ux-spec.md)).

## Performance budget

- Shell adds ~7KB gz of CSS + ~9KB gz of JS for the chrome primitives (excluding icons).
- App-bar scroll listener is `passive: true`.
- Bottom nav scroll listener is `passive: true` and gated behind a 6px delta + reduced-motion check.
- Service-worker install precaches only the four primary routes + manifest + 192/512 icons; runtime caches grow lazily.
- `font-display: swap` is implicit via the system stack used for `Inter Variable` fallback.

## Lighthouse

Target on `/`, `/world-cup-2026`, `/watch` (desktop simulation):
- PWA: >=95
- Best Practices: >=95
- Accessibility: >=90

The actual Lighthouse run lives behind a follow-up CI job. Manual sanity check: `next dev -p 3500` -> Chrome DevTools -> Lighthouse -> mobile, all categories.

## Known issues / follow-ups

- The Next 14 production build of `/team/[code]` (force-static) trips a "Cannot read properties of null (reading 'useContext')" prerender error inherited from `main`. Reproduced on `main` before this PR's changes were applied; not caused by the shell. Tracked as a separate fix.
- The 2nd-tier shell items (Leaderboard, Syndicates, Settings) on the side rail point at routes that are stub pages or 404. Filling them is in the roadmap (per [doc 09](09-agent-task-breakdown.md) agents J / O).
- The push-notifications wiring exists in `sw.js` but the subscription registration lives in `apps/push-notifications` and is not yet imported by the web app.
- Capacitor-native shell (in flight under `feat/capacitor-native-shell`) shares the same chrome via the same primitives — no fork expected.
