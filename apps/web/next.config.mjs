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
  // The renderer scene is fully client-side; SSR doesn't render WebGL.
  // We still keep the route file structure under `app/` so that we can use
  // server components for layout, OG image generation, and future REST.
  experimental: {
    // Workspace packages are imported as TS source, Next 14 transpiles them.
    externalDir: true,
    // @resvg/resvg-js loads platform-specific native bindings at runtime;
    // webpack mustn't try to bundle those. Same for satori (server-only).
    serverComponentsExternalPackages: [
      "@resvg/resvg-js",
      "satori",
      // @napi-rs/canvas loads platform-specific .node bindings (skia)
      // at runtime, webpack cannot bundle them. The bracket-share
      // PNG / MP4 routes route through @tournamental/social-cards which uses
      // it server-side.
      "@napi-rs/canvas",
      "@tournamental/social-cards",
    ],
  },
  transpilePackages: [
    "@tournamental/spec",
    "@tournamental/spec-client",
    "@vtorn/avatar",
    "@tournamental/bracket-engine",
  ],
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

export default nextConfig;
