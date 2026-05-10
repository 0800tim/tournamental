import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SPEC_VERSION } from '@vtorn/spec';

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, '../../package.json');

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
  name: string;
  version: string;
};

export async function registerVersion(app: FastifyInstance) {
  app.get(
    '/v1/version',
    {
      schema: {
        tags: ['health'],
        summary: 'Service version',
        description:
          'Identifies the running service, package version, spec version, and environment. Cached for 60s.',
        response: {
          200: {
            type: 'object',
            required: ['service', 'version', 'spec_version', 'env', 'ts'],
            properties: {
              service: { type: 'string' },
              version: { type: 'string' },
              spec_version: { type: 'string' },
              env: { type: 'string' },
              ts: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    },
    async (_req, reply) => {
      reply.header('Cache-Control', 'public, max-age=60');
      return {
        service: pkg.name,
        version: pkg.version,
        spec_version: SPEC_VERSION,
        env: process.env.NODE_ENV ?? 'development',
        ts: new Date().toISOString(),
      };
    },
  );
}
