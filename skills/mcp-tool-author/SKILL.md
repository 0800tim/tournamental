---
name: mcp-tool-author
description: Add a new tool to the Tournamental MCP server. Tier choice, Zod schema, audit hook, registration.
license: Apache-2.0
---

# When to use this skill

The user wants to expose a new capability to AI agents (Claude
Desktop, Cursor, Continue) via MCP. Examples that have shipped:
`get_team`, `get_leaderboard`, `submit_bracket`, `admin_resolve_match`.
Examples that would be net-new: `subscribe_to_leaderboard`,
`search_news`, `get_friend_picks`.

# How to do it

## 1. Pick a tier

The MCP server has three tiers, defined at
[`apps/mcp/src/lib/auth.ts`](../../apps/mcp/src/lib/auth.ts):

- **public** — no auth, anonymous, rate-limited per IP. Read-only.
- **user** — requires personal API key
  (`Authorization: Bearer tnm_live_…` or stdio `userKey`). Reads
  per-user state, can mutate the user's own data.
- **admin** — requires master admin key + IP allowlist match.
  Reads + mutates global state. Operator-only.

Default to **public**. Only escalate to **user** if the call
requires per-user context. Only escalate to **admin** if it
mutates global state.

## 2. Write the tool

Each tool lives in `apps/mcp/src/tools/<name>.ts`:

```ts
import { z } from "zod";
import type { ToolDefinition } from "../types.js";

const Input = z.object({
  teamCode: z.string().regex(/^[A-Z]{3}$/),
});
const Output = z.object({
  team: z.object({ code: z.string(), name: z.string(), rank: z.number() }),
});

export const getTeam: ToolDefinition<typeof Input, typeof Output> = {
  name: "get_team",
  tier: "public",
  title: "Get team metadata",
  description: "Fetch a national team's metadata by three-letter code.",
  inputSchema: Input,
  outputSchema: Output,
  async handler(input, ctx) {
    const team = await ctx.gameClient.getTeam(input.teamCode);
    return { team };
  },
};
```

## 3. Register it

Add the tool to the export in
[`apps/mcp/src/tools/index.ts`](../../apps/mcp/src/tools/index.ts).
The catalogue at `/mcp/catalogue` picks it up automatically — no
extra wiring.

## 4. Add an audit-log line for the user / admin tiers

`ctx.audit({ tool, userId, args: <safe-shape> })` runs after the
handler. Public-tier tools skip this for noise reduction. See
existing tools for the shape.

## 5. Test it

```ts
// apps/mcp/tests/<your-tool>.test.ts
import { describe, it, expect } from "vitest";
import { getTeam } from "../src/tools/get-team.js";
import { makeTestCtx } from "./helpers.js";

describe("get_team", () => {
  it("returns metadata for a valid code", async () => {
    const ctx = makeTestCtx({ teams: [{ code: "BRA", name: "Brazil", rank: 1 }] });
    const r = await getTeam.handler({ teamCode: "BRA" }, ctx);
    expect(r.team.name).toBe("Brazil");
  });
});
```

## 6. Smoke-test against a running MCP server

```bash
pnpm --filter @tournamental/mcp dev   # boots on :3399
curl -sS http://localhost:3399/mcp/tools | jq '.tools[] | select(.name=="get_team")'
```

# Acceptance checks

- `pnpm --filter @tournamental/mcp typecheck` green.
- `pnpm --filter @tournamental/mcp test` includes a passing test
  for the new tool.
- `curl /mcp/catalogue` lists the new tool with its full
  JSON-Schema for input + output.
- For user-tier tools: an unauthenticated call returns 401.
- For admin-tier tools: a call from an unallowed IP returns 403
  even with a valid admin key.

# Boundaries

- DO NOT add a tool that exposes secrets (API keys, JWTs, raw
  Supabase rows) — those are server-only.
- DO NOT add a public-tier tool that performs an unbounded
  expensive operation. Public-tier is rate-limited at 60 RPM /
  IP today; an O(48-team-cascade) tool exceeds that budget.
- DO NOT bypass the existing `gameClient` / `identityClient`
  abstractions. Plumbing a fresh `fetch()` to a service URL
  duplicates the auth + retry layer and is a request-changes.
