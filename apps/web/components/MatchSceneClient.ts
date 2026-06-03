"use client";

/**
 * Client-only `next/dynamic` shim for the heavy WebGL `MatchScene`.
 *
 * Next 15 forbids `ssr: false` on `next/dynamic` inside a server
 * component, so the actual `dynamic(...)` call lives here under a
 * `"use client"` directive. Server pages (`/match/[id]`, `/replay/[id]`)
 * import this re-export as if it were the component itself.
 *
 * MatchScene is unavoidably client-only: it builds a Three.js scene,
 * which needs a real DOM and WebGL context, neither of which exist
 * during server rendering.
 */

import dynamic from "next/dynamic";

export const MatchScene = dynamic(
  () => import("@/components/MatchScene").then((m) => m.MatchScene),
  { ssr: false },
);
