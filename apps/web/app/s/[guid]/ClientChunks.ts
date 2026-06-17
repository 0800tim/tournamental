"use client";

/**
 * Client-only dynamic-import shims for the /s/[guid] share landing.
 *
 * Next 15 forbids `ssr: false` on `next/dynamic` calls placed inside a
 * server component. We moved each declaration here, where the
 * `"use client"` directive lets the option through, and the parent
 * server page imports the named exports as if they were direct
 * components.
 *
 * Why we still bother with dynamic imports + `ssr: false`:
 *
 *   - Tim 2026-06-04 hit a webpack `options.factory` runtime crash on
 *     /s/<handle> landings when several large client components hydrated
 *     from the same RSC chunk. Splitting each into its own client chunk
 *     after hydration sidesteps the bug without changing the components.
 *   - The page is `force-dynamic` server-side; nothing here ever runs
 *     during SSR, so disabling SSR for these heavy components is also a
 *     clean perf win (no double-render).
 */

import nextDynamic from "next/dynamic";

export const ReadOnlyBracket = nextDynamic(
  () =>
    import("@/components/share-landing/ReadOnlyBracket").then(
      (mod) => mod.ReadOnlyBracket,
    ),
  { ssr: false, loading: () => null },
);

export const ShareMoleculeEmbed = nextDynamic(
  () =>
    import("@/components/share-landing/ShareMoleculeEmbed").then(
      (mod) => mod.ShareMoleculeEmbed,
    ),
  { ssr: false, loading: () => null },
);

export const JoinSyndicate = nextDynamic(
  () =>
    import("@/components/share-landing/JoinSyndicate").then(
      (mod) => mod.JoinSyndicate,
    ),
  { ssr: false, loading: () => null },
);

export const SyndicateLeaderboardRows = nextDynamic(
  () =>
    import("@/components/share-landing/SyndicateLeaderboardRows").then(
      (mod) => mod.SyndicateLeaderboardRows,
    ),
  { ssr: false, loading: () => null },
);

export const PoolLeaderboardLive = nextDynamic(
  () =>
    import("@/components/share-landing/PoolLeaderboardLive").then(
      (mod) => mod.PoolLeaderboardLive,
    ),
  { ssr: false, loading: () => null },
);

export const BracketPosterCallout = nextDynamic(
  () =>
    import("@/components/share-landing/BracketPosterCallout").then(
      (mod) => mod.BracketPosterCallout,
    ),
  { ssr: false, loading: () => null },
);

export const ShareBracketButton = nextDynamic(
  () =>
    import("@/components/share-landing/ShareBracketButton").then(
      (mod) => mod.ShareBracketButton,
    ),
  { ssr: false, loading: () => null },
);

// Tim 2026-06-18: was admin-only on /dashboard/pools/<slug>, now also
// on the public /s/<guid> page so members can see who's on the prize-
// winning streak. Same component, polled every 30s on the public side.
export const PicksGrid = nextDynamic(
  () =>
    import("@/components/pool-admin/PicksGrid").then((mod) => mod.PicksGrid),
  { ssr: false, loading: () => null },
);
