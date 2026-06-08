import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The deploy orchestrator (infra/deploy/lib/publish.ts) builds into a
  // per-slot directory so the live PM2 process can keep reading the
  // current `.next-prod` while the new `.next-staging` is built + smoke-
  // tested. Next doesn't honour NEXT_BUILD_DIR natively and rejects
  // absolute paths in `distDir`, so we accept the env var and pass
  // through just the basename. Unset → default `.next`. Mirrors the
  // identical block in apps/web/next.config.mjs.
  ...(process.env.NEXT_BUILD_DIR
    ? { distDir: process.env.NEXT_BUILD_DIR.replace(/^.*\//, "") || ".next" }
    : {}),
  // Pin the file-tracing root at the monorepo root (vtorn/) so Next 15
  // doesn't probe upwards and pick up an unrelated package-lock.json
  // sitting in ~/clawdia/. Without this, builds emit a noisy "we
  // detected multiple lockfiles" warning.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // better-sqlite3 has native bindings; webpack must NOT try to bundle
  // it. The escape hatch in App Router used to be
  // `experimental.serverComponentsExternalPackages` in Next 14; it was
  // promoted to `serverExternalPackages` in Next 15.
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    externalDir: true,
  },
  // Source uses React 19 / Next 15 typings (recharts JSX-class shape,
  // async cookies/headers) but we're running Next 14.2.35 / React 18
  // until Next 15 is promoted to prod (Tim 2026-06-04). Skip the
  // prod-bundle typecheck; CI/dev typecheck still runs.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
