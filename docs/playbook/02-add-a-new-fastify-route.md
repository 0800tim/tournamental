# Playbook 02 — Adding a new Fastify route

> **When to use this.** You're adding an HTTP endpoint to an existing Fastify service.

## The shape we use

Routes live in `src/routes/<area>.ts` and export a `register*` function that takes the `FastifyInstance`. The pattern across the codebase:

```ts
import type { FastifyInstance } from 'fastify';

export async function registerExample(app: FastifyInstance) {
  app.get('/v1/example', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { ok: true, ts: Date.now() };
  });
}
```

The bootstrap then `await app.register()`s the registrar — but most services already do `await registerExample(app);` directly because Fastify's `.get/.post` calls are synchronous-from-the-caller. Either is fine; match the surrounding file.

## Add an OpenAPI annotation

Two ways. Pick whichever the surrounding file already uses:

### Option A — JSON schema inline (most concise)

```ts
app.post(
  '/v1/example',
  {
    schema: {
      tags: ['example'],
      summary: 'Create an example',
      description: 'Persists an example record and returns its id.',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          note: { type: 'string', maxLength: 2000 },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'created_at'],
        },
        400: { $ref: 'BadRequest#' },
      },
    },
  },
  async (req) => {
    // body is typed by the inferred schema if you bind generics:
    const { name, note } = req.body as { name: string; note?: string };
    const row = await ctx.store.create({ name, note });
    return { id: row.id, created_at: row.createdAt };
  },
);
```

### Option B — zod schema with a converter

If the service already pulls `zod` (most do), define the zod schema where the route registers and convert on the fly:

```ts
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const Body = z.object({
  name: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

app.post('/v1/example', {
  schema: {
    tags: ['example'],
    body: zodToJsonSchema(Body, 'ExampleBody'),
    response: { 200: zodToJsonSchema(z.object({ id: z.string() }), 'ExampleResponse') },
  },
}, async (req) => {
  const body = Body.parse(req.body);
  // ...
});
```

Both produce a valid OpenAPI fragment in the generated spec.

### Always include

- `tags: [<area>]` — the service's `registerSwagger` lists tags so the UI groups routes.
- `summary` — one short sentence. Verb-first imperative.
- `description` — optional; only when the summary isn't enough.
- `response` — at minimum a 200/2xx shape and any explicitly-handled error codes.

## Add a test

Every route gets at least one test. The pattern (Vitest, in-memory):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../src/server.js';

describe('POST /v1/example', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({ dbPath: ':memory:' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates an example', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/example',
      payload: { name: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: expect.any(String) });
  });

  it('rejects empty name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/example',
      payload: { name: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

`app.inject` doesn't bind a port — fast and parallel-safe.

## Cache headers

Per [`../22-deployment-and-tunnels.md`](../22-deployment-and-tunnels.md):

- User-specific data → `Cache-Control: private, no-store`
- Public list / aggregate → `Cache-Control: public, max-age=<seconds>, s-maxage=<longer>, stale-while-revalidate=<longer>`
- HTML / health / version → `Cache-Control: no-store` (or short `public, max-age=60` for version)

Always set the header *explicitly* in the handler, even if it duplicates a default. This is what the reviewer agent looks for.

## Auth

If the route is admin-only, gate via `app.addHook('onRequest', ...)` that checks the bearer token (`<APP>_ADMIN_TOKEN` from env). Most services already have a `requireAdmin` helper — search for it before re-implementing.

If the route is user-scoped, the user id comes from the `X-User-Id` header (dev mesh) or from a verified JWT in production. Match the surrounding service.

## Regenerate the OpenAPI dump

```bash
pnpm --filter @vtorn/<service> dump-openapi
git add docs/api/<service>.openapi.json
```

Always commit the regenerated dump — the docs/api/ JSONs are the contract surface for downstream consumers.

## Common mistakes

- **No schema = no entry in `/docs`.** Routes without a schema show up as `parameters: any`, which is useless. Always annotate.
- **Missing `tags`.** A tagless route shows up under "default" — confusing for callers.
- **Forgetting cache headers.** Reviewer agent comment: "every public surface has an explicit cache policy."
- **Tests boot a real DB.** Use `:memory:` (better-sqlite3 supports it directly). Tests must not write outside the workspace.
- **Forgetting to commit the dump.** CI catches this when it diffs the dumps; it's still annoying.
