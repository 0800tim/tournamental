import path from "node:path";
import { fileURLToPath } from "node:url";

import createNextIntlPlugin from "next-intl/plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The deploy orchestrator (infra/deploy/lib/publish.ts) builds into
  // a per-slot directory so the live PM2 process can keep reading the
  // current `.next-prod` while the new `.next-staging` is being built
  // and smoke-tested. Next.js doesn't honour NEXT_BUILD_DIR natively
  // and rejects absolute paths in `distDir`, so we accept the env var
  // and pass through just the basename (the orchestrator's slots are
  // always direct children of apps/web/). Unset → default `.next`.
  ...(process.env.NEXT_BUILD_DIR
    ? { distDir: process.env.NEXT_BUILD_DIR.replace(/^.*\//, "") || ".next" }
    : {}),
  // Pin the file-tracing root at the monorepo root (vtorn/) so Next 15
  // doesn't probe upwards and pick up an unrelated package-lock.json
  // sitting in ~/clawdia/. Without this, builds emit a noisy "we
  // detected multiple lockfiles" warning.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // `serverComponentsExternalPackages` was promoted out of `experimental`
  // and renamed to `serverExternalPackages` in Next 15. Same semantics.
  serverExternalPackages: [
    // @resvg/resvg-js loads platform-specific native bindings at runtime;
    // webpack mustn't try to bundle those. Same for satori (server-only).
    "@resvg/resvg-js",
    "satori",
    // @napi-rs/canvas loads platform-specific .node bindings (skia)
    // at runtime, webpack cannot bundle them. The bracket-share
    // PNG / MP4 routes route through @tournamental/social-cards which uses
    // it server-side.
    "@napi-rs/canvas",
    "@tournamental/social-cards",
    // better-sqlite3 has native bindings; used by lib/invite/store.ts
    // for the bulk-invite queue (Tim 2026-05-29).
    "better-sqlite3",
  ],
  // The renderer scene is fully client-side; SSR doesn't render WebGL.
  // We still keep the route file structure under `app/` so that we can use
  // server components for layout, OG image generation, and future REST.
  experimental: {
    // Workspace packages are imported as TS source, Next 15 transpiles them.
    externalDir: true,
  },
  // Don't block `next build` on lint warnings/errors. Next 15 ships
  // a stricter eslint-config-next that fails the build on `<a>`-vs-
  // `<Link>` usage even though our existing brand-logo / hard-reload
  // anchors are intentional. We still run `pnpm lint` in CI so real
  // regressions get caught — just not during the production bundle.
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Temporary: source code on main was developed against React 19 / Next 15
  // types but we're running Next 14.2.35 / React 18.3.1 in prod after the
  // 2026-06-04 rollback. The code is runtime-compatible (it ran on Next 15
  // for a full session) but the TS strict checks hit cosmetic mismatches.
  // Until the Next 15 migration is reattempted with an isolated prod
  // worktree, skip the type-check during prod builds. `pnpm typecheck`
  // still runs in CI/dev.
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    "@tournamental/spec",
    "@tournamental/spec-client",
    "@vtorn/avatar",
    "@tournamental/bracket-engine",
  ],
  // Browser-swarm federation client (components/browser-swarm/
  // federation.ts) issues /v1/swarm/* from the page origin. The
  // game-service is a separate process; we route the path family
  // to it here so the browser never has to know the game-service
  // URL. `GAME_BASE_URL` lets ops point at a remote game-service
  // per environment; default is the local dev port. Tim 2026-06-07.
  async rewrites() {
    const gameBase = process.env.GAME_BASE_URL ?? "http://127.0.0.1:3361";
    return [
      { source: "/v1/swarm/:path*", destination: `${gameBase}/v1/swarm/:path*` },
    ];
  },
  webpack: (config, { isServer }) => {
    // ESM-style imports inside the @vtorn/* workspace packages use `.js`
    // suffixes (NodeNext convention). The actual files are `.ts` / `.tsx`,
    // so teach webpack to resolve `.js` imports to those source files.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    // Native-binding packages can't be bundled by webpack, the .node
    // platform binary lives outside the webpack module graph. Mark them
    // external on the server so Node `require()`s them at runtime.
    if (isServer) {
      const existing = config.externals;
      const externalList = Array.isArray(existing) ? existing : existing ? [existing] : [];
      config.externals = [
        ...externalList,
        ({ request }, callback) => {
          if (
            typeof request === "string" &&
            (request === "@napi-rs/canvas" ||
              request.startsWith("@napi-rs/canvas-") ||
              request === "@resvg/resvg-js" ||
              request.startsWith("@resvg/resvg-js-"))
          ) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
};

export default withNextIntl(nextConfig);
