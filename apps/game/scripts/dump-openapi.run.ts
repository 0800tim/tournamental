/**
 * Vitest-driven OpenAPI dumper for @vtorn/game.
 *
 * The game service's `src/server.ts` is currently in flight (per-match-pick-popup
 * agent owns it). To avoid touching their file mid-edit, the dumper builds
 * a parallel Fastify instance, registers swagger first, then calls the same
 * route registrars used by the real server. This produces a faithful spec
 * without mutating src/server.ts.
 *
 * Once the sibling agent's PR lands, the orchestrator wires
 * `await registerSwagger(app)` into src/server.ts immediately after
 * `app.register(sensible)`, and this dumper can switch back to importing
 * `buildServer` directly (matching every other service).
 */

import Fastify from 'fastify';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, expect } from 'vitest';

import { GameStore } from '../src/store/db.js';
import { LeaderboardCache } from '../src/scoring/cache.js';
import { registerHealth } from '../src/routes/health.js';
import { registerBracketRoutes } from '../src/routes/bracket.js';
import { registerMatchRoutes } from '../src/routes/match.js';
import { registerLeaderboardRoutes } from '../src/routes/leaderboard.js';
import { registerSyndicateRoutes } from '../src/routes/syndicate.js';
import { registerPunditRoutes } from '../src/routes/pundit.js';
import { registerSwagger } from '../src/swagger.js';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../../../docs/api/game.openapi.json');

test('dump-openapi: writes game spec', async () => {
  const store = new GameStore({ dbPath: ':memory:' });
  const cache = new LeaderboardCache(30_000);

  const app = Fastify({ logger: false });
  await registerSwagger(app); // Registered FIRST so onRoute hooks every route below.

  await registerHealth(app, store);
  await registerBracketRoutes(app, { store });
  await registerMatchRoutes(app, { store, cache, adminToken: 'dump-stub-admin-token' });
  await registerLeaderboardRoutes(app, { store, cache });
  await registerSyndicateRoutes(app, { store, adminToken: 'dump-stub-admin-token' });
  await registerPunditRoutes(app, {
    store,
    adminToken: 'dump-stub-admin-token',
    suppressJsonl: true,
  });

  await app.ready();
  const spec = (app as { swagger: () => unknown }).swagger();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
  await app.close();
  expect((spec as { openapi: string }).openapi).toBe('3.0.0');
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
});
