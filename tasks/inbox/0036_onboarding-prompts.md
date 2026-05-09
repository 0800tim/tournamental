---
id: 0036
title: Onboarding prompt library
owner: unassigned
status: inbox
created: 2026-05-09
updated: 2026-05-09
priority: P2
labels: [marketing, developer-experience]
links:
  doc: docs/26-platform-strategy-and-syndicates.md
---

## What

`prompts/onboarding/` directory of self-contained markdown prompts users paste into Claude / Cursor / ChatGPT to walk through claiming a syndicate, configuring scoring, sharing, etc. Mirrored on the marketing site at `vtourn.com/start`.

## Why

The MCP server is the structured path; the prompt library is the *unstructured* path. Many users have a Claude/Cursor/ChatGPT session open and just want "give me the prompt that does this." It also doubles as marketing — every prompt links back to vtourn.com.

## Acceptance

- [ ] Prompts shipped (each ≤ 3 KB, self-contained, runnable in any major LLM):
  - `00-claim-your-syndicate.md`
  - `01-pick-a-tournament.md`
  - `02-configure-scoring.md`
  - `03-share-and-grow.md`
  - `04-host-toolkit.md`
  - `05-developer-quickstart.md`
- [ ] Each prompt references `apps/mcp/` tools where structured operations are available, falling back to `apps/api` REST calls otherwise.
- [ ] Marketing site `/start` page renders these prompts with copy buttons.
- [ ] Each prompt closes with a "next step" link to the next prompt.
