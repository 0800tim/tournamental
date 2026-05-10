import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '../../package.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
  name: string;
  version: string;
};

export async function registerVersion(app: FastifyInstance): Promise<void> {
  app.get('/v1/version', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: pkg.name,
      version: pkg.version,
      env: process.env.NODE_ENV ?? 'development',
      ts: new Date().toISOString(),
    };
  });

  app.get('/', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return {
      service: 'vtorn-news-aggregator',
      docs: 'https://github.com/0800tim/vtorn/blob/main/docs/49-news-aggregator.md',
      health: '/healthz',
      version: '/v1/version',
      news: '/v1/news',
      sources: '/v1/sources',
    };
  });
}
