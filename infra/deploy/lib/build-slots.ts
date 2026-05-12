/**
 * build-slots.ts — slot path + buildKind helpers.
 *
 * The blue-green slot pattern:
 *   - prod serves from `<slot>-prod` (e.g. `.next-prod`)
 *   - we build to `<slot>-staging` (e.g. `.next-staging`)
 *   - on swap, prod-prev <- prod, prod <- staging
 *
 * This module is the single source of truth for what those paths *are*
 * for each kind of app we deploy.
 */

import * as path from 'node:path';

export type BuildKind = 'next' | 'astro' | 'node' | 'fastify';

export interface SlotPaths {
  /** Where the new build is written. Always rebuilt fresh per deploy. */
  staging: string;
  /** What the running prod process points at. */
  prod: string;
  /** Previous prod build, kept for rollback. */
  prev: string;
  /** Quarantined failed-build dir; populated by rollback path only. */
  failed: string;
}

export interface SlotSpec {
  kind: BuildKind;
  /** Absolute path to the app working directory (where package.json lives). */
  appDir: string;
  /**
   * Optional override for the slot prefix. Defaults:
   *   - next: '.next'
   *   - astro: 'dist'
   *   - node | fastify: 'dist'
   */
  prefix?: string;
}

const DEFAULT_PREFIX: Record<BuildKind, string> = {
  next: '.next',
  astro: 'dist',
  node: 'dist',
  fastify: 'dist',
};

/**
 * Compute the four slot paths for a given app + kind.
 * All paths are absolute.
 */
export function slotPaths(spec: SlotSpec): SlotPaths {
  const prefix = spec.prefix ?? DEFAULT_PREFIX[spec.kind];
  const base = path.resolve(spec.appDir);
  return {
    staging: path.join(base, `${prefix}-staging`),
    prod: path.join(base, `${prefix}-prod`),
    prev: path.join(base, `${prefix}-prev`),
    failed: path.join(base, `${prefix}-failed`),
  };
}

/**
 * The build command for each kind. Run with NODE_ENV=production and the
 * environment variables already loaded (the publish.ts orchestrator handles
 * env-loading from `.env.<env>` files).
 *
 * Important: every command writes to the staging slot, NEVER to the live
 * prod slot. We rely on env vars where the tool supports them
 * (NEXT_BUILD_DIR for Next), and on a final `mv` for tools that don't
 * (Astro, tsc).
 */
export function buildCommand(spec: SlotSpec, slots: SlotPaths): {
  cmd: string;
  env: Record<string, string>;
  /**
   * Some kinds (astro, tsc) build to a fixed dir name and we move it after.
   * If `postMove` is set, the orchestrator should `mv {postMove.from} {postMove.to}`
   * after a successful build.
   */
  postMove?: { from: string; to: string };
} {
  switch (spec.kind) {
    case 'next':
      // Next supports NEXT_BUILD_DIR via env / config.
      return {
        cmd: 'pnpm run build',
        env: { NEXT_BUILD_DIR: slots.staging, NODE_ENV: 'production' },
      };
    case 'astro':
      // Astro always writes to `dist/` per astro.config; we move it after.
      return {
        cmd: 'pnpm run build',
        env: { NODE_ENV: 'production' },
        postMove: {
          from: path.join(spec.appDir, 'dist'),
          to: slots.staging,
        },
      };
    case 'node':
    case 'fastify':
      // Fastify/Node services use tsc. Build to `dist/` and move it.
      return {
        cmd: 'pnpm run build',
        env: { NODE_ENV: 'production' },
        postMove: {
          from: path.join(spec.appDir, 'dist'),
          to: slots.staging,
        },
      };
  }
}

/**
 * The start command for the running prod process.
 * The orchestrator typically wraps this in PM2 (so we just need the cmd).
 *
 * - Next: `next start --hostname 0.0.0.0 --port <port>` (with NEXT_BUILD_DIR
 *   pointing at the prod slot).
 * - Astro: `node ./dist-prod/server/entry.mjs` if SSR, or static-served
 *   by a separate webserver — for now we assume `astro preview` is fine
 *   for the marketing site since it's mostly static.
 * - Fastify/Node: `node <slot>/index.js` (built output).
 */
export function startCommand(
  spec: SlotSpec,
  slots: SlotPaths,
  port: number,
): { cmd: string; env: Record<string, string> } {
  switch (spec.kind) {
    case 'next':
      return {
        cmd: `npx next start --hostname 0.0.0.0 --port ${port}`,
        env: { NEXT_BUILD_DIR: slots.prod, NODE_ENV: 'production' },
      };
    case 'astro':
      // Astro static deploys are served by Cloudflare/Nginx in prod; in
      // single-host mode we use astro preview pointing at the prod slot.
      return {
        cmd: `npx astro preview --host 0.0.0.0 --port ${port}`,
        env: { NODE_ENV: 'production', ASTRO_OUT_DIR: slots.prod },
      };
    case 'node':
    case 'fastify':
      return {
        cmd: `node --enable-source-maps ${slots.prod}/index.js`,
        env: { NODE_ENV: 'production' },
      };
  }
}

/**
 * The smoke command for the throwaway test server. Bound to 127.0.0.1
 * (never publicly exposed) on the smoke port.
 */
export function smokeStartCommand(
  spec: SlotSpec,
  slots: SlotPaths,
  smokePort: number,
): { cmd: string; env: Record<string, string> } {
  switch (spec.kind) {
    case 'next':
      return {
        cmd: `npx next start --hostname 127.0.0.1 --port ${smokePort}`,
        env: { NEXT_BUILD_DIR: slots.staging, NODE_ENV: 'production' },
      };
    case 'astro':
      return {
        cmd: `npx astro preview --host 127.0.0.1 --port ${smokePort}`,
        env: { NODE_ENV: 'production', ASTRO_OUT_DIR: slots.staging },
      };
    case 'node':
    case 'fastify':
      return {
        cmd: `node --enable-source-maps ${slots.staging}/index.js`,
        env: { NODE_ENV: 'production', PORT: String(smokePort), HOST: '127.0.0.1' },
      };
  }
}
