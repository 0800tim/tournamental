---
id: 0035
title: '@vtourn/mcp' Model Context Protocol server
owner: unassigned
status: inbox
created: 2026-05-09
updated: 2026-05-09
priority: P2
labels: [mcp, developer-experience]
links:
  doc: docs/26-platform-strategy-and-syndicates.md
---

## What

`apps/mcp/` MCP server, publishable as `@vtourn/mcp` on npm. Users run `npx @vtourn/mcp` in Claude Desktop / Cursor / any MCP-aware client to get a set of VTourn capabilities surfaced as tools and resources.

## Why

A creator can say "set up a Six Nations syndicate at `kiwi-fans.vtourn.com`, gold/silver/bronze, NZ$10 host-handled buy-in, invite my Telegram contacts" and the MCP-aware client orchestrates the API calls. This is the lowest-friction path from "interest" to "running a tournament."

## Acceptance

- [ ] Tools (per `docs/26`): `syndicate.create/invite`, `tournament.list/attach`, `predictions.submit`, `leaderboards.get`, `match.stream`.
- [ ] Resources: `vtourn://syndicate/{slug}`, `vtourn://match/{id}/snapshot/{t_ms}`, `vtourn://tournament/{id}/predictions`.
- [ ] Auth: prompts the user once for an `sk_*` key, stores it in the OS keychain via `keytar`.
- [ ] Rate-limited (1 req/sec / IP / endpoint).
- [ ] Published to npm; `npx @vtourn/mcp` works.
- [ ] README with Claude-Desktop integration JSON snippet + example transcript.

## Notes

- Use the official `@modelcontextprotocol/sdk` package.
- The MCP server is a thin proxy over `apps/api`; it doesn't reimplement business logic.
