# Playbook 01, Adding a new app

> **When to use this.** You have a new bounded service or surface that doesn't fit any existing app. New micro-services, new front-end surfaces, new CLI tools all start here.
>
> **When NOT to use this.** A new feature inside an existing service is *not* a new app. A new shared library is a new package, not a new app, see `packages/` for those.

## Decision: app or package

| | App (`apps/<name>`) | Package (`packages/<name>`) |
| --- | --- | --- |
| Has its own port | yes | no |
| Has a `start` script (long-running) | yes | rarely (only CLI bins) |
| Imported by other workspaces | rare | always |
| Owns its own database / data dir | sometimes | no |
| Has tunnel ingress rules | yes | no |

If you're between, default to package, it's easier to extract an app from a package than to refactor an app into a package.

## Workspace expectations

Every app under `apps/` must have:

1. **`package.json`** with these scripts at minimum:
   - `dev`, `tsx watch src/<entry>.ts` (watch-mode dev server)
   - `build`, `tsc -p tsconfig.json` (compile to `dist/`)
   - `start`, `node dist/<entry>.js` (production boot)
   - `prestart`, same as `build` (so `pnpm start` always boots clean)
   - `typecheck`, `tsc -p tsconfig.json --noEmit`
   - `test`, `vitest run`
2. **`tsconfig.json`** that extends `../../tsconfig.base.json`.
3. **`README.md`** with one-paragraph what-it-does, a port table, the env-var list, and a link to the relevant doc(s).
4. **A `/healthz` endpoint**, return `{ ok: true, ts: Date.now() }` minimum.
5. **A `/v1/version` endpoint**, return `{ service, version, spec_version, env, ts }`.
6. **A test file** that boots the server with an in-memory store and round-trips at least one request via `app.inject(...)`.

If the app speaks HTTP, register `@fastify/swagger` + `@fastify/swagger-ui` per [Playbook 02](02-add-a-new-fastify-route.md). Generated spec lands in `docs/api/<name>.openapi.json`.

## Choose a port

The single source of truth for ports is [`docs/22-deployment-and-tunnels.md`](../22-deployment-and-tunnels.md).

Conventions:

- 3300–3399 for HTTP services
- 4000–4099 for WebSocket / streaming services
- 5400–5499 for databases (dev-bound only)
- 6300–6399 for caches (dev-bound only)

Pick the next free port. Add a row to the table in `docs/22-deployment-and-tunnels.md` *in the same PR* that creates the app, this is non-negotiable.

## Tunnel ingress

Each maintainer's dev tunnel routes `<service>.<their-dev-domain>` to the local port. If your tunnel is remote-managed, do not edit local YAML; use the Cloudflare API procedure in `docs/22-deployment-and-tunnels.md`. Open a session note describing the new ingress rule.

If you need a quick dev-only tunnel for testing webhooks, `cloudflared tunnel --url http://localhost:<port>` gets you a randomised URL, fine for one-off webhook testing, never commit it anywhere.

## Daily-report inventory

[`tools/daily-report`](../../tools/daily-report) inventories every app and reports their healthz status. Add your new app's healthz URL to its services list when you ship the first running PR.

## Example walk-through

You're scaffolding `apps/example-service` on port 3399.

```bash
mkdir -p apps/example-service/src/routes apps/example-service/test apps/example-service/data
cd apps/example-service

cat > package.json <<'EOF'
{
  "name": "@vtorn/example-service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "prestart": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "dump-openapi": "tsx scripts/dump-openapi.ts"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.1",
    "@fastify/helmet": "^12.0.1",
    "@fastify/sensible": "^6.0.1",
    "@fastify/swagger": "^9.0.0",
    "@fastify/swagger-ui": "^5.0.0",
    "pino": "^9.5.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.16.11",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.5"
  }
}
EOF

cat > tsconfig.json <<'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
EOF
```

Then implement `src/server.ts`, `src/swagger.ts`, `src/routes/health.ts`, and at least one feature route. Add a row to the table in `docs/22-deployment-and-tunnels.md`. Open a draft PR.

## Common mistakes

- **Skipping the prestart.** Without it, `pnpm start` boots stale `dist/` after a code change.
- **Hard-coding the port.** Always read from env (`<APP>_PORT`) with a default. Tests inject `0` (kernel-assigned) and read back `app.server.address()`.
- **Skipping the healthz.** The daily-report breaks. The orchestrator's standing rule: *no healthz, no merge.*
- **No swagger.** API consumers including the dashboard front-end shouldn't have to read your source to call you.
- **Touching `pnpm-workspace.yaml`.** The pattern `apps/*` already picks you up. The only reason to touch the workspace file is if you've genuinely added a new tier alongside `apps/` and `packages/`.
