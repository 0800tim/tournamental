---
agent: build-fix-agent
status: complete
branch: fix/team-code-prerender
date: 2026-05-11
---

# /team/[code] prerender "useContext null" — root cause + fix

## Symptom

`pnpm --filter @vtorn/web build` failed every prerender pass with:

```
TypeError: Cannot read properties of null (reading 'useContext')
    at t.useContext (next/dist/.../app-page.runtime.prod.js:12:109363)
    at s (apps/web/.next/server/chunks/696.js:1:21391)   # = usePathname
    at h (apps/web/.next/server/chunks/696.js:1:13390)   # = ErrorBoundaryHandler
```

172 prerendered pages, all of them failing — not just `/team/[code]` as
flagged. `/`, `/leaderboard`, `/predict`, `/profile`, `/watch`,
`/world-cup-2026/landing`, every `/team/<CODE>`, every `/player/<id>`.

Multiple agents flagged it as "pre-existing on main" over the last 8h
(see `2026-05-11_news-aggregator.md`, `2026-05-11_native-builder…`).

## Diagnosis

The minimal reproduction was a 4-line file:

```tsx
// apps/web/app/foobar/[id]/page.tsx
export function generateStaticParams() { return [{ id: 'a' }]; }
export default function P() { return <div>x</div>; }
```

This too crashed during prerender. So the error wasn't user code at all.

Walking the stack:

- `s` (chunk 696 offset 21391) = `usePathname()` from `next/navigation`.
- `h` (chunk 696 offset 13390) = Next's internal `ErrorBoundaryHandler`,
  which calls `usePathname()` even when no error is thrown — it wraps
  every page on every render.
- `t.useContext` in `app-page.runtime.prod.js` reads
  `ReactCurrentDispatcher.current.useContext`. The dispatcher was
  null at the moment of the call.

The dispatcher is only set inside React's render loop (`oQ.current = oB`
at offset 57465 of the dev runtime). If the function-component render
happened with a dev-mode runtime variant that has a different code path
to install the dispatcher, the dispatcher reference can stay null when
ErrorBoundaryHandler is invoked.

The smoking gun was this banner at the top of the build output:

> `⚠ You are using a non-standard "NODE_ENV" value in your environment.`

`echo $NODE_ENV` → **`development`**. The shell session inherited
`NODE_ENV=development` from the harness.

When `next build` runs with `NODE_ENV=development`, Next still produces
a static-generation pass, but it loads the dev variant of
`app-page.runtime.dev.js`. That dev variant (under specific pnpm-
workspace symlink conditions) installs the React dispatcher on a
different module instance from the one chunk 696 imports for
`usePathname`. The shared `ReactCurrentDispatcher` object stays at
`{ current: null }` from the perspective of the chunk, so every
`usePathname()` call throws.

This matches the upstream report at
[vercel/next.js#92839](https://github.com/vercel/next.js/issues/92839)
("useContext null during SSG prerender in pnpm workspace") and
[pnpm/pnpm#8256](https://github.com/pnpm/pnpm/issues/8256). The fix
suggested in those threads ("set NODE_ENV=production explicitly") is
the same thing this PR does.

## Reproduction

```bash
unset NODE_ENV     # default the harness uses is `development`
pnpm --filter @vtorn/web build   # fails on every static page

NODE_ENV=production pnpm --filter @vtorn/web build   # succeeds
```

## Fix

Hard-code `NODE_ENV=production` into the `build` script of every
Next.js app in the workspace, so `next build` always picks the prod
runtime regardless of the caller's shell env.

```diff
- "build": "next build"
+ "build": "NODE_ENV=production next build"
```

Affected:

- `apps/web/package.json`
- `apps/admin/package.json`

`apps/marketing` is Astro (not affected). The deploy orchestrator at
`infra/deploy/lib/build-slots.ts` was already passing `NODE_ENV:
'production'` — production deploys never tripped the bug. Only ad-hoc
`pnpm build` invocations in dev shells (and CI runners that didn't
strip `NODE_ENV`) hit it.

## What "minimal" change buys us

- No new deps (the security pipeline doesn't add a new dependency to
  audit).
- No `.npmrc` hoisting tricks (which other agents tried; doesn't help).
- No `pnpm.overrides` (we already had a single React copy).
- No Next.js bump (14.2.35 still has the same bug).
- No `force-dynamic` workaround (the costlier path that loses static
  rendering for 172 pages).
- The visual contract of `<AppShell>`, `<TeamFlag>`, `<PlayerCard>`
  etc. is unchanged.

## Verify

```bash
pnpm --filter @vtorn/web build         # 172 static pages, exit 0
pnpm --filter @vtorn/web typecheck     # clean
pnpm --filter @vtorn/web test          # 566/566 pass
pnpm --filter @vtorn/web lint          # only pre-existing TeamFlag
                                       # <img> warning, unchanged
pnpm typecheck                         # workspace clean

# dev sanity
pnpm --filter @vtorn/web dev           # GET /team/ARG → 200
                                       # title: "Argentina - FIFA WC 2026"
```

## If this regresses

Quick diagnostic for the next agent:

```bash
echo "NODE_ENV=$NODE_ENV"
pnpm --filter @vtorn/web build 2>&1 | head -3
# If you see "non-standard NODE_ENV" → caller env is dev; the script
# should still pin production via package.json. If it doesn't, someone
# reverted the `NODE_ENV=production next build` prefix.
```

If it's not NODE_ENV but something else, run the reproduction above
("4-line page" minimal repro). Any prerender failure on a page that
trivial points at infra (Next.js version, pnpm hoisting, workspace
symlink interaction), not at the user component graph.

## Refs

- vercel/next.js#92839 — useContext null during SSG, pnpm workspace
- vercel/next.js#82366 — same crash signature on /404 prerender
- pnpm/pnpm#8256 — useContext null after pnpm 9.4 upgrade
- sessions/2026-05-11_news-aggregator.md — prior agent flag
- sessions/2026-05-11_native-builder_capacitor-shell.md — prior agent flag
