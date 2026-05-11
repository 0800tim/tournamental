# @tournamental/mcp

Model Context Protocol (MCP) server for Tournamental. Exposes the
tournament API as a tool surface for any MCP-aware agent: Claude
Desktop, Cursor, Windsurf, Continue, and friends. Vibe-code a bracket
app, a leaderboard widget, or a syndicate dashboard in twenty minutes.

> Apache-2.0 licensed. Built on the official
> [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk)
> v1.29.0 (pinned).

## Why this exists

The Tournamental REST API is open and documented, but every agent
author was writing the same five lines of HTTP plumbing. MCP lets us
publish the contract once and let agents discover the tools by name
with input/output schemas attached.

See [`docs/53-mcp-server.md`](../../docs/53-mcp-server.md) for the
full design rationale, security model, and example agent walkthroughs.

## Tool tiers

| Tier   | Tools | Auth                                            | Rate limit            |
| ------ | ----- | ----------------------------------------------- | --------------------- |
| Public | 7     | none                                            | 60 req/min/IP         |
| User   | 5     | `Authorization: Bearer <user-api-key>`          | 600 req/min/user-key  |
| Admin  | 3     | `X-Tournamental-Admin-Key: <key>` + IP allowlist | 6000 req/min/admin-key |

### Public (no auth)

- `get_team` - team metadata by three-letter code
- `get_tournament` - tournament state, groups, fixtures
- `get_leaderboard` - global / syndicate / friends rankings
- `get_bracket_by_guid` - resolve a public share guid to a bracket
- `get_syndicate` - public syndicate metadata (no PII)
- `get_match_path` - projected champion path for a team
- `query_molecule` - 48-atom + bond molecule for any public bracket

### User-scoped (Bearer)

- `submit_bracket` - submit a bracket prediction
- `update_pick` - upsert a single match pick
- `lock_picks` - lock picks up to a fixture
- `save_share_guid` - adopt a client-minted share guid
- `set_handle` - set display handle

### Admin

- `admin_resolve_match` - write a canonical match result
- `admin_list_pending_users` - moderation queue
- `admin_invalidate_share` - revoke a public share guid

## Quick start

### Run locally (stdio)

```bash
# From the monorepo root
pnpm install
pnpm --filter @tournamental/mcp build

# Stdio - what Claude Desktop / Cursor / Windsurf spawn
node apps/mcp/dist/bin/cli.js

# Or via the bin shim (once published to npm)
npx @tournamental/mcp
```

### Run locally (HTTP + SSE)

```bash
pnpm --filter @tournamental/mcp dev          # tsx watch on :3395
# or after build:
node apps/mcp/dist/bin/cli.js --mode=http --port=3395
```

Then:

```bash
curl http://127.0.0.1:3395/healthz
curl http://127.0.0.1:3395/mcp/tools | jq .   # public catalogue
```

### Wire it into Claude Desktop

Add the snippet from
[`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json)
to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the Windows equivalent, then restart Claude Desktop.

### Wire it into Cursor

See [`examples/cursor-config.json`](./examples/cursor-config.json) for
the `~/.cursor/mcp.json` entry.

### Wire it into Windsurf

See [`examples/windsurf-config.json`](./examples/windsurf-config.json).

## Environment variables

| Var                        | Default                          | Used in        | Notes                                                  |
| -------------------------- | -------------------------------- | -------------- | ------------------------------------------------------ |
| `TOURNAMENTAL_USER_KEY`    | (none)                           | stdio          | Forwarded as `Authorization: Bearer` to user tools     |
| `TOURNAMENTAL_ADMIN_KEY`   | (none)                           | stdio          | Forwarded for admin tools                              |
| `TOURNAMENTAL_ADMIN_IPS`   | (empty)                          | http           | CSV allowlist for admin-tier callers                   |
| `GAME_BASE_URL`            | `http://127.0.0.1:3360`          | both           | Upstream game-service                                  |
| `MCP_PORT`                 | `3395`                           | http           | HTTP listen port                                       |
| `MCP_BIND`                 | `0.0.0.0`                        | http           | HTTP bind address                                      |
| `MCP_CORS_ORIGINS`         | `mcp.tournamental.com,localhost` | http           | CSV of allowed CORS origins                            |
| `MCP_AUDIT_PATH`           | `./data/mcp-audit.jsonl`         | both           | JSONL audit log path                                   |
| `LOG_LEVEL`                | `info`                           | http           | pino log level                                         |
| `LOG_PRETTY`               | `0`                              | http           | `1` for pino-pretty in dev                             |

## Audit log

Every tool call writes one line to `$MCP_AUDIT_PATH`. The line includes
the tool name, caller (IP / user-key prefix / admin-key prefix), the
request (with secret fields redacted), the response status, and
latency. For OSS contributors self-hosting their own MCP, this is the
canonical "what is my agent doing" view:

```bash
tail -f data/mcp-audit.jsonl | jq .
```

## Tests

```bash
pnpm --filter @tournamental/mcp test         # vitest run
pnpm --filter @tournamental/mcp typecheck    # tsc --noEmit
pnpm --filter @tournamental/mcp build        # tsc to dist/
```

Tests use an in-process fake `fetch` injected through `GameClient`'s
`fetchImpl` option - no network, no `nock`, no flakes.

## Layout

```
apps/mcp/
├── src/
│   ├── bin/cli.ts                # entrypoint, parses --mode + flags
│   ├── server.ts                 # buildMcpServer() factory
│   ├── transports/
│   │   ├── stdio.ts              # stdio bootstrap
│   │   └── http.ts               # Fastify + SSE + /mcp/tools catalogue
│   ├── tools/catalogue.ts        # the 15 tool definitions
│   └── lib/
│       ├── schemas.ts            # zod input/output schemas
│       ├── game-client.ts        # upstream game-service HTTP client
│       ├── auth.ts               # tier + IP allowlist
│       ├── rate-limit.ts         # in-memory token bucket
│       ├── audit.ts              # JSONL audit logger
│       └── dispatch.ts           # auth → ratelimit → validate → run → audit
├── tests/read-tools.test.ts      # 16 contract tests
└── examples/                     # Claude Desktop / Cursor / Windsurf configs
```

## Self-hosting

The whole thing is one process. To run your own MCP host:

1. `git clone` the Tournamental monorepo
2. Set `GAME_BASE_URL` to whichever game-service you trust (production
   is `https://game.tournamental.com`)
3. `pnpm --filter @tournamental/mcp build && node apps/mcp/dist/bin/cli.js --mode=http`
4. Point your agent at `http://your-box:3395/mcp`

All tool calls hit your audit log. The upstream game-service does the
actual writes - your MCP host is a thin policy + observability layer.

## Roadmap (v0.2)

Parked for the next iteration, in priority order:

- Redis-backed rate-limit shared with `apps/game` and `apps/affiliate-router`
- WebSocket transport (real-time leaderboard streaming)
- `subscribe_leaderboard` and `subscribe_match` MCP `notifications` surface
- `prompts/` catalogue (pre-canned agent prompts for common workflows)
- OAuth 2.1 + PKCE for user-key issuance (per the MCP spec)
- Tool-level `_meta.cache_hint` so agents can negotiate freshness
