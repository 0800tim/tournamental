# Playbook 05, Rolling out a feature flag

> **When to use this.** You're adding a backend that has a "real" implementation (Sportradar, GoHighLevel, real Drips on-chain) and want a "mock" path for tests + dev.

## The convention: `<APP>_BACKEND=mock|real`

Every service that has a switchable backend uses the same env-var pattern:

| Service | Env var | Values |
| --- | --- | --- |
| crm-bridge | `CRM_BACKEND` | `mock` (default) \| `real` |
| drips-bridge | `DRIPS_BACKEND` | `mock` (default) \| `real` |
| dm-poll-forwarder | `POLL_BACKEND` | `mock` (default) \| `real` |
| wc2026-data | `WC2026_DATA_BACKEND` | `mock` (default) \| `sportradar` \| `apifootball` |
| auth-sms | `WHATSAPP_TRANSPORT` | `aiva` (default) \| `baileys` \| `stub` |

Pattern principles:

1. **Default to mock.** Production sets `=real` explicitly. Dev never accidentally hits a real provider.
2. **Tests pin the value.** Either via `process.env.<APP>_BACKEND='mock'` in a `beforeEach` or via dependency injection (preferred, see below).
3. **One flag per concern.** Don't bolt three flags onto the same service. If you have three concerns, you have three services.

## Adding a new flag

Step 1, extract the abstraction.

```ts
// src/lib/example-client.ts
export interface ExampleClient {
  send(payload: ExamplePayload): Promise<ExampleResponse>;
}

export class MockExampleClient implements ExampleClient {
  // logs to a JSONL audit file; no network
}

export class RealExampleClient implements ExampleClient {
  constructor(private cfg: { apiKey: string; baseUrl: string }) {}
  async send(payload) { /* fetch, retry, observe */ }
}

export type ExampleBackend = 'mock' | 'real';

export function makeExampleClient(backend: ExampleBackend, cfg?: ...): ExampleClient {
  return backend === 'real'
    ? new RealExampleClient(requireRealConfig(cfg))
    : new MockExampleClient();
}
```

Step 2, wire it in the bootstrap.

```ts
// src/server.ts
const backend = (process.env.EXAMPLE_BACKEND ?? 'mock') as ExampleBackend;
const client = makeExampleClient(backend, {
  apiKey: process.env.EXAMPLE_API_KEY,
  baseUrl: process.env.EXAMPLE_API_BASE_URL,
});
```

Step 3, log on boot. Always log which backend was selected:

```ts
app.log.info({ backend }, 'example client backend selected');
```

This shows up in healthz/audit and saves debugging hours when something is "broken" but is actually pointed at the wrong env.

## Gating routes

Most flags don't gate routes, they swap the implementation behind a route. But if you do need to hide a route entirely:

```ts
if (backend === 'real') {
  await registerExampleRealOnlyRoutes(app);
}
```

Avoid this when possible. A consistent route surface that returns a stable mock response is easier to consume than a route that 404s in some configurations.

## Testing both modes

```ts
describe('example service', () => {
  it.each(['mock', 'real'] as const)(
    'works with %s backend',
    async (backend) => {
      const app = await buildServer({
        client: makeExampleClient(backend, testConfig),
      });
      // ... test happy path
    },
  );
});
```

For the `real` mode, mock the network at the `fetch` boundary (use `nock` or `undici`'s `MockAgent`). Don't actually call out, tests must work offline.

## Documenting the flag

In the service's README, under a `### Backends` heading:

```markdown
### Backends

This service supports two backends, selected by `EXAMPLE_BACKEND`:

- `mock` (default): logs to `data/example-calls.jsonl`. Used in dev and tests.
- `real`: HTTPs to the Example API. Requires `EXAMPLE_API_KEY` and `EXAMPLE_API_BASE_URL`.

Boot with `EXAMPLE_BACKEND=real EXAMPLE_API_KEY=<key>` to switch.
```

Add the env vars to [`../25-keys-and-secrets-required.md`](../25-keys-and-secrets-required.md) in the same PR.

## Killing a flag

When the real backend is solid and the mock is no longer used in production:

1. Make `real` the default.
2. Wait one sprint to confirm nothing broke.
3. Remove the flag entirely. Delete the mock client (or move it to tests as a fixture).

Do not let flags accumulate. Each one is a configuration the platform must support forever.

## Common mistakes

- **Reading the env var inside the route handler instead of at boot.** Forces tests to fight the env. Read once at boot, pass the resolved client into routes.
- **Crashing if `=real` env vars are missing in dev.** Should fall back to mock with a warning. Only crash in `NODE_ENV=production`.
- **Hard-coding the env-var name in tests.** Tests should construct the client directly via DI; if they have to set env vars, the abstraction is wrong.
