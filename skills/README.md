# skills/

Capability descriptions for AI agents in the [Anthropic Agent Skills
format](https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md)
(published 2025-12-18, supported by 32 tools as of 2026-03 including
Claude Code, Claude Desktop, Cursor, Junie, Kiro, Gemini CLI, Goose,
and Continue).

Each subdirectory contains a single `SKILL.md` describing one
high-leverage capability an agent can invoke while working in this
repo. The format is intentionally narrower than a plugin — a skill
captures **how to do one thing well**, with executable detail.

## What's here

| Skill | One-liner |
| --- | --- |
| [`scoring-rules/`](scoring-rules/) | Compute Tournamental scoring for any bracket + result set. Use when the user asks "what would my score be if X won?" or when building a new scorer plugin. |
| [`syndicate-create/`](syndicate-create/) | Create a branded syndicate via the game-service API: pick a slug, validate it against reserved words, configure branding + format, return the live URL. |
| [`renderer-debug/`](renderer-debug/) | Triage a renderer issue: which producer is feeding it, what spec version, is the stream healthy, are the avatars / kits / billboards loading. |
| [`mcp-tool-author/`](mcp-tool-author/) | Add a new tool to the Tournamental MCP server. Walks through tier choice, Zod schema, audit-log hook, and registration. |

## Pattern

Each `SKILL.md` follows the [Anthropic Agent Skills v1
spec](https://github.com/anthropics/skills/blob/main/spec/agent-skills-spec.md):

```markdown
---
name: <skill-name>
description: <one-line description>
license: Apache-2.0
---

# When to use this skill
...

# How to do it
1. ...
2. ...

# Acceptance checks
...
```

Skills are discoverable by name (the directory name) and by tool
catalogue (the Tournamental MCP server at `mcp.tournamental.com`
emits `/mcp/catalogue` with a `skills` array referencing this
directory).

## Adding a skill

PRs welcome. The bar:

- One folder, one `SKILL.md`, optional `examples/` subdirectory.
- Skill name is `kebab-case`, ≤ 32 chars.
- `description` ≤ 120 chars, action-oriented.
- "How to do it" section MUST include executable detail (curl
  invocations, code snippets, file paths) — not paragraphs of prose.
- "Acceptance checks" section MUST list one or more machine-verifiable
  outcomes ("a 200 from /v1/syndicate/&lt;slug&gt;", "vitest passes the
  fixture", "the file at path X now contains Y").

Open the PR with label `skill` so the reviewer agent runs the
skill-specific checklist.
