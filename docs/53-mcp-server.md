# 53, Model Context Protocol server

> Tournamental published as a tool surface for AI agents. Read this if
> you're building an agent that needs to query the leaderboard, submit a
> bracket, write a syndicate-aware Slack bot, or vibe-code a tournament
> companion app inside Claude Desktop. The service lives at
> [`apps/mcp/`](../apps/mcp/) and ships as `@tournamental/mcp` on npm.

This doc deliberately complements [docs 12](12-odds-and-predictions.md)
(game-service API surface), [docs 32](32-auth-and-privacy.md) (the auth
plane) and [docs 22](22-deployment-and-tunnels.md) (where it runs). It
does not re-derive the contracts; it explains the tool surface, the
three auth tiers, the rate-limit model, and how an OSS contributor
self-hosts.

## Why a Model Context Protocol server

The Tournamental REST API is open and documented (`/v1/*`), but every
agent author was writing the same five lines of HTTP plumbing on top of
it: tool definitions, input validation, retry, error coercion. The
[Model Context Protocol](https://modelcontextprotocol.io) is the
industry-standard "tool catalogue" shape that Claude Desktop, Cursor,
Windsurf, Continue, and a growing list of agents speak natively. We
publish our tool surface once, in MCP-native form, and every MCP-aware
agent picks it up by name.

Two practical wins:

1. **Twenty-minute bracket apps.** A user opens Claude Desktop, enables
   the Tournamental MCP server, and types "make me a Streamlit app that
   shows the top-10 global leaderboard". The agent has `get_leaderboard`
   in its toolbox already; it doesn't need to read our OpenAPI spec to
   find it.
2. **A contract surface for partners.** Affiliates, syndicate sponsors,
   and our own internal tools (the admin console, the news aggregator,
   the social publisher) can call MCP tools without going through HTTP
   boilerplate. The same audit log catches every call.

## Three tool tiers

| Tier   | Auth                                            | Rate    | Tools |
| ------ | ----------------------------------------------- | ------- | ----- |
| Public | none                                            | 60/min/IP | 7     |
| User   | `Authorization: Bearer <user-api-key>`          | 600/min/user-key | 5  |
| Admin  | `X-Tournamental-Admin-Key: <key>` + IP allowlist | 6000/min/admin-key | 3 |

The tier on each tool is part of its identity - every MCP `tools/list`
response carries a `[tier]` prefix in the description so an agent
configured without admin credentials cannot accidentally pick an admin
tool.

### Public read tools (no auth)

| Tool | What it does |
| ---- | ------------ |
| `get_team` | Team metadata: name, FIFA rank, flag emoji, confederation, kit colours. |
| `get_tournament` | Current tournament state (groups, fixture count, knockout-lock state). Defaults to FIFA WC 2026. |
| `get_leaderboard` | Ranked list of bracket scores. Scope `global` / `syndicate` / `friends`. Returns `preview=true` until first kickoff. |
| `get_bracket_by_guid` | Resolve a public share guid to a bracket summary: champion + podium + path + locked-at. Optional `includePayload` returns the full saved bracket. |
| `get_syndicate` | Public syndicate metadata: display name, member count, share URL. No PII. |
| `get_match_path` | Project a team's path to the trophy given an undefeated run. |
| `query_molecule` | Return the 48-atom + bond graph for a bracket's 3D molecule view. |

### User-scoped writes (`Authorization: Bearer`)

| Tool | What it does |
| ---- | ------------ |
| `submit_bracket` | Persist a full bracket prediction. Server returns the bracket id, share guid, and locked-at. |
| `update_pick` | Upsert a single match prediction. Server still enforces kickoff lockouts. |
| `lock_picks` | Mark some subset of the caller's picks locked. |
| `save_share_guid` | Adopt a client-minted share guid so the share URL resolves immediately. |
| `set_handle` | Set the caller's public display handle. Subject to profanity check. |

### Admin (`X-Tournamental-Admin-Key`)

| Tool | What it does |
| ---- | ------------ |
| `admin_resolve_match` | Write the canonical match result. Triggers scoring recompute across every affected bracket. |
| `admin_list_pending_users` | Moderation queue. |
| `admin_invalidate_share` | Revoke a public share guid. |

## Transports

The same tool definitions are exposed in two ways:

### stdio (default)

```bash
npx -y @tournamental/mcp
```

This is what Claude Desktop, Cursor, Windsurf, and Continue spawn when
you add the server to their config. The MCP client talks JSON-RPC over
the spawned process's stdin/stdout. Local-only by definition. Auth keys
come from env vars set in the agent's config block, so the operator
never types a token mid-chat.

### HTTP + SSE (hosted)

The same binary started with `--mode=http`:

```bash
node apps/mcp/dist/bin/cli.js --mode=http --port=3395
```

surfaces three routes:

| Route                  | Auth | Purpose                                                        |
| ---------------------- | ---- | -------------------------------------------------------------- |
| `POST /mcp`            | per-call | The MCP "Streamable HTTP" transport. SSE-streamed JSON-RPC. |
| `GET /mcp/tools`       | none | Public catalogue: every tool's name, tier, description, JSON-Schema in + out. |
| `POST /v1/tool/:name`  | per-call | Direct REST mirror of a tool call. Same auth + rate-limit + audit pipeline. |
| `GET /healthz`         | none | Liveness probe. |
| `GET /`                | none | Root descriptor. |

Hosted deployment is `https://mcp.tournamental.com` (prod) and
`https://vtorn-mcp.aiva.nz` (dev). Both are added to
[`docs/22-deployment-and-tunnels.md`](22-deployment-and-tunnels.md) in
the same PR.

## Auth model

### Public tier

No auth. The server reads no headers at all on public-tier calls.
Rate-limited per source IP.

### User tier

Resolved in this priority order:

1. `Authorization: Bearer <user-api-key>` (HTTP transport)
2. `X-Tournamental-User-Key: <user-api-key>` (HTTP transport)
3. `userKey` field inside the tool's input (stdio fallback - most MCP
   stdio clients can't set HTTP headers, so the per-user token is
   carried in the env at spawn time and the dispatcher reads it from
   `TOURNAMENTAL_USER_KEY`).

The user-key is forwarded as `Authorization: Bearer` to the
game-service's `/v1/me/*` endpoints; the game-service is the
authoritative source of "what user is this".

End users mint, rotate and revoke their personal user-keys at
[`/profile/api-keys`](../apps/web/app/profile/api-keys/page.tsx) on
play.tournamental.com. The token format and full self-service contract
live in [docs/54](54-personal-api-keys.md). The plaintext key is shown
ONCE at mint time and never recoverable; users paste it into
`TOURNAMENTAL_USER_KEY` in their MCP client config and treat it like a
password.

### Admin tier

Resolved in this priority order:

1. `X-Tournamental-Admin-Key: <key>` (HTTP transport)
2. `adminKey` field inside the tool's input (stdio fallback)

On the HTTP transport, the caller's source IP must also appear in
`TOURNAMENTAL_ADMIN_IPS` (comma-separated). Stdio mode is implicitly
local so the IP check is skipped.

Admin keys are issued out-of-band by ops and rotated quarterly.

## Rate limits

In-memory token bucket, 60-second window, three tiers:

| Tier   | Limit         | Key                                |
| ------ | ------------- | ---------------------------------- |
| Public | 60 req/min    | source IP                          |
| User   | 600 req/min   | first 12 chars of user-key         |
| Admin  | 6000 req/min  | first 12 chars of admin-key        |

When the limit is hit the dispatcher returns `429 rate_limited` with
`X-RateLimit-Limit / -Remaining / -Reset` headers (on HTTP) or an
`isError: true` MCP `CallToolResult` (over stdio/SSE).

**Migration plan**: when `apps/game` and `apps/affiliate-router` finish
their Redis migration, the MCP server picks up a shared `RedisRateLimiter`
so a multi-host deployment doesn't have to allowlist by host. Until
then the in-memory limit is fine for a single-host MCP.

## Audit log

Every tool call writes a line to `$MCP_AUDIT_PATH` (default
`./data/mcp-audit.jsonl`). Schema:

```json
{
  "ts": "2026-05-11T18:01:33.420Z",
  "tool": "get_leaderboard",
  "tier": "public",
  "ip": "8.8.8.8",
  "user_prefix": null,
  "admin_prefix": null,
  "request": { "tournamentId": "fifa-wc-2026", "scope": "global" },
  "status": "ok",
  "http_code": 200,
  "latency_ms": 12
}
```

Secrets are redacted (`userKey` becomes `"abcd***"`, never logged in
full). For OSS contributors who self-host, this is the canonical
"what is my agent doing right now" view:

```bash
tail -f data/mcp-audit.jsonl | jq .
```

## Example: build your bracket app in 20 minutes with Claude Desktop

1. **Install the MCP server**. Add the snippet from
   [`apps/mcp/examples/claude-desktop-config.json`](../apps/mcp/examples/claude-desktop-config.json)
   into `~/Library/Application Support/Claude/claude_desktop_config.json`
   and restart Claude Desktop.

2. **Get a user key** from `https://play.tournamental.com/account/keys`
   and drop it into the `TOURNAMENTAL_USER_KEY` env in the config.

3. **Verify the server is healthy**. In Claude Desktop, type:

   > Use the Tournamental MCP server to list the first three tools.

   You should see `get_team`, `get_tournament`, `get_leaderboard` come
   back as a structured response.

4. **Ask for the app**:

   > Make me a single-page React app, served by Vite, that displays the
   > top-20 of the global FIFA World Cup 2026 leaderboard. Refresh
   > every 30 seconds. Style it like a sports-betting app - dark
   > background, neon green accents. Use the Tournamental MCP server
   > for the data.

   Claude pulls `get_leaderboard` from the catalogue, hits the
   public-tier endpoint without an API key, and scaffolds a Vite
   project that polls every 30 seconds.

5. **Iterate**:

   > Now add a "submit my bracket" button that lets the user pick a
   > champion and submits it via the MCP server.

   Claude finds `submit_bracket` and `set_handle` in the catalogue,
   sees that they require a user-key, and wires the UI accordingly.
   The MCP server forwards the call to `apps/game`'s `/v1/bracket/submit`.

If a tool errors, the audit log shows exactly why. If the agent picks
the wrong tool, the descriptions in `apps/mcp/src/tools/catalogue.ts`
are the place to tighten - that's the prompt-engineering surface.

## Caching

The MCP service is mostly a thin policy + observability layer over
`apps/game`. Caching policies follow the
[docs/22](22-deployment-and-tunnels.md) matrix:

- `GET /mcp/tools` - `public, max-age=60, stale-while-revalidate=600`
  (catalogue changes every release; daily edge cache absorbs traffic
  from agent autodiscovery)
- `GET /healthz` - `no-store`
- `GET /` - `public, max-age=60`
- `POST /mcp`, `POST /v1/tool/:name` - `no-store` (tool calls are not
  cacheable; the upstream sets its own cache headers)

Inside the tool handlers, `get_leaderboard` and `get_bracket_by_guid`
inherit the game-service's existing edge caches via the upstream call;
the MCP layer adds no second cache to avoid stale-after-write surprises
on user writes.

## Performance budget

- Cold start: < 500ms
- Hot tool dispatch (public-tier, upstream-cached): < 50ms p95
- Hot tool dispatch (user-tier, upstream miss): < 250ms p95
- Memory: < 80MB resident for a single-host deployment

These are measured weekly per the
[docs/22](22-deployment-and-tunnels.md) caching-and-perf review.

## Self-hosting

The whole thing is one Node process. To run your own MCP host:

1. `git clone` the Tournamental monorepo (or `npm i @tournamental/mcp`)
2. Set `GAME_BASE_URL` to whichever game-service you trust
3. `pnpm --filter @tournamental/mcp build && node apps/mcp/dist/bin/cli.js --mode=http`
4. Point your agent at `http://your-box:3395/mcp` (or stdio'ed via
   `npx`)

All tool calls hit *your* audit log. The upstream game-service handles
the authoritative writes - your MCP host is a thin policy + audit
layer. If you self-host for an internal team, set
`TOURNAMENTAL_ADMIN_IPS` to your private subnet so only your jump-host
can call admin tools.

## What's not in v0.1

Parked for v0.2, in roadmap priority:

- Redis-backed rate-limit shared with the rest of the stack
- WebSocket subscription transport (`subscribe_leaderboard`,
  `subscribe_match`)
- Pre-canned agent prompts under MCP's `prompts/` namespace ("Build me
  a bracket app", "Audit my syndicate", "Draft a shareable bracket")
- OAuth 2.1 + PKCE for user-key issuance per the MCP spec, so users
  can grant scoped access to a hosted agent without copy-pasting keys
- Tool-level `_meta.cache_hint` so agents negotiate freshness instead
  of polling
- A `vstamp` tool tier once
  [docs 17](17-vstamp-and-prediction-iq.md) lands

## See also

- [`apps/mcp/README.md`](../apps/mcp/README.md) - the engineering README
- [`apps/mcp/examples/`](../apps/mcp/examples/) - Claude / Cursor /
  Windsurf MCP configs
- [docs 12](12-odds-and-predictions.md) - the underlying game-service API
- [docs 32](32-auth-and-privacy.md) - the auth plane
- [docs 22](22-deployment-and-tunnels.md) - where MCP runs in dev /
  staging / prod
