---
agent: mcp-author
task: ship the @tournamental/mcp Model Context Protocol server (v0.1)
docs: docs/53-mcp-server.md, docs/22-deployment-and-tunnels.md, docs/12-odds-and-predictions.md
status: complete
---

# 2026-05-11 - MCP-Author - initial MCP server

## Plan

1. Build `apps/mcp/` as a workspace package (`@tournamental/mcp`).
2. Two transports: stdio (default) + HTTP+SSE (hosted on port 3395,
   `mcp.tournamental.com` in prod).
3. 15 tools across three tiers: 7 public, 5 user, 3 admin.
4. Auth: per-tier - public none, user `Authorization: Bearer`, admin
   `X-Tournamental-Admin-Key` + IP allowlist.
5. Rate limit: 60 / 600 / 6000 req/min (public / user / admin).
6. JSONL audit log at `$MCP_AUDIT_PATH` (default `./data/mcp-audit.jsonl`).
7. Public catalogue at `GET /mcp/tools` (no auth, used for agent discovery).
8. Contract tests for all 7 public read tools + auth gating + rate
   limiting + audit redaction.
9. `docs/53-mcp-server.md` (new) + `docs/22-deployment-and-tunnels.md`
   (updated with port row).
10. Three example configs: Claude Desktop, Cursor, Windsurf.
11. AGENT-PROMPTS.md gains a section 6 for the MCP-Author Agent.

## What landed

- `apps/mcp/` workspace package, pinned to
  `@modelcontextprotocol/sdk@1.29.0`.
- `src/lib/schemas.ts` - Zod schemas for every tool's input + output.
- `src/lib/game-client.ts` - thin HTTP client to the upstream game-service.
- `src/lib/auth.ts` - tier-aware auth resolver + IP allowlist.
- `src/lib/rate-limit.ts` - in-memory token bucket (Redis TODO noted).
- `src/lib/audit.ts` - JSONL writer with secret redaction.
- `src/lib/dispatch.ts` - the unified pipeline: auth → ratelimit →
  validate → handler → output-validate → audit.
- `src/tools/catalogue.ts` - the 15 tool definitions, the registry,
  and the `publicCatalogue()` JSON-Schema export.
- `src/server.ts` - `buildMcpServer()` factory used by both transports.
- `src/transports/stdio.ts`, `src/transports/http.ts`, `src/bin/cli.ts`.
- `tests/read-tools.test.ts` - 16 contract tests, all green.
- `README.md` + `LICENSE` (Apache-2.0).
- `examples/claude-desktop-config.json`, `cursor-config.json`,
  `windsurf-config.json`.

## Port choice

The original task brief asked for port 3370, but
`docs/22-deployment-and-tunnels.md` already assigns that to
`apps/affiliate-router`. I picked **3395** (free, sits between
`apps/vstamp:3390` and `apps/news-aggregator:3402`) and added the row
to docs/22 + the doc-53 URL plan in the same PR.

## What I parked for v0.2 (added to IDEAS.md candidates)

- Redis-backed rate-limit shared with `apps/game` and
  `apps/affiliate-router`. In-memory is fine for single-host.
- WebSocket subscription transport (`subscribe_leaderboard`,
  `subscribe_match`).
- Pre-canned agent prompts under MCP's `prompts/` namespace.
- OAuth 2.1 + PKCE for user-key issuance per the MCP spec.
- Tool-level `_meta.cache_hint` so agents negotiate freshness.

## Verification

- `pnpm --filter @tournamental/mcp typecheck` - clean.
- `pnpm --filter @tournamental/mcp test` - 16/16 passing.
- `pnpm --filter @tournamental/mcp build` - clean.
- Smoke test: booted `--mode=http --port=3895`, hit `/`, `/healthz`,
  `/mcp/tools`, `POST /v1/tool/get_team` (validation + upstream
  paths), and `POST /mcp` with a JSON-RPC `initialize` envelope.
  All four paths returned the expected shapes.

## Next steps

- Build the Cloudflare tunnel ingress row for `mcp.tournamental.com`
  (deferred - orchestrator owns the tunnel API).
- Publish to npm under `@tournamental/mcp` once the npm org is
  registered (Tim owns that).
- Add `apps/mcp` to the deploy pipeline in
  `infra/deploy/promote-to-prod.ts` (parked - current deploy script
  doesn't enumerate apps, so a contributor PR can add it later).
