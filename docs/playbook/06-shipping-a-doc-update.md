# Playbook 06, Shipping a doc update

> **When to use this.** You're updating an existing doc, adding a new doc, or your code change touched a public surface and the relevant doc is now stale.

## The rule

**A code change without a doc change is incomplete.** This is enforced by the orchestrator and reviewer agent, PRs that mutate a public surface (route, env var, port, schema) without updating the relevant doc are sent back.

## When code changes, what changes in docs

| Code change | Doc change |
| --- | --- |
| New env var | [`../25-keys-and-secrets-required.md`](../25-keys-and-secrets-required.md) + service README |
| New port | [`../22-deployment-and-tunnels.md`](../22-deployment-and-tunnels.md) port table |
| New / changed route | regenerate `../api/<service>.openapi.json`; update service README route table; if substantial, write or update the relevant feature doc |
| New service | new entry in [`../README.md`](../README.md), new entry in [`../api/README.md`](../api/README.md), new row in port table |
| New domain term | append to [`../glossary.md`](../glossary.md) |
| Change to spec types | [`../02-spec.md`](../02-spec.md), orchestrator-only change |
| Bug fix in already-documented behaviour | usually no doc change unless the doc described the bug |

## Numbering

- Existing docs stay numbered; if a doc grows large enough to split, the children take a letter suffix (`27a-...`, `27b-...`).
- New docs pick the next free number near related docs. Number ranges:
  - `00-09`, vision, scope, agent breakdown
  - `10-19`, product surfaces (renderer, predictions, modes, scoring, social, brand)
  - `20-29`, ops, deployment, security, fidelity roadmap
  - `30-39`, growth, gamification, marketing, PWA shell, UX
  - `40-49`, adjacent surfaces (Drips, DM-poll, live data)
- Renumbering is rare and orchestrator-only. If you're tempted, open an IDEAS.md entry first.

## When to archive

A doc is archived to `docs/archive/<YYYY-MM-DD>_<original-name>.md` only when:

1. It's been fully replaced by another doc, and
2. Every link to it has been redirected to the replacement.

Old session notes (>30 days) auto-archive to `sessions/archive/`. Old docs do not auto-archive, that's an explicit decision.

## Style conventions

- Prose, not code-heavy. The docs explain *why* and *when*; code lives in the repo.
- One H1 per file (the title).
- Tables for "X vs Y" comparisons and for indexes.
- Lists for enumerated steps.
- Code blocks for shell snippets and small TS/JSON examples, not for algorithm pseudocode.
- NZ English (colour, behaviour). No emdashes.
- Voice: terse, declarative. Imperative for instructions.
- Cross-link liberally. A doc that doesn't link to related docs is half-done.

## Updating the hive-mind index

The agent-readable index lives at [`../README.md`](../README.md). If you add a new doc, add a row in the matching section. Keep the summary to one line.

If the matching section doesn't exist, ask whether a new section is justified. Most docs fit an existing section.

## PR conventions for doc-only changes

```
docs(<area>): <imperative summary>

Body explains why the doc needed updating, what changed in the code or the
product surface that the doc was describing. Link the related code PR if
this is a follow-up.

Refs: docs/<n>
```

Doc-only PRs don't need a long test plan. The reviewer agent runs `markdown-link-check` to verify relative links and that's the bar.

## Code + doc PRs

If your PR is mostly code with a doc update, the commit message structure is the same as a code change, the doc update is part of the diff, not a separate commit. Reviewer agent counts code-with-doc as one work unit.

If you find yourself making a doc-only commit *after* the code commit landed, that's a sign the original PR was incomplete. The orchestrator will note it but won't bounce it.

## Checking your work

```bash
# Validate every relative link in changed docs
npx markdown-link-check docs/<doc>.md

# Spot-check the rendered Markdown locally
glow docs/<doc>.md     # or your preferred renderer
```

If you used a tool to draft the doc (LLM-assisted), still read it through end to end. The hive-mind needs accuracy more than fluency.
