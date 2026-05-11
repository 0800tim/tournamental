# 57. Agentic Development at Tournamental

> How the Tournamental repo is structured so that AI coding agents
> can do most of the work, with humans at the helm setting
> direction, holding the spec, and merging the result.

This is the operating manual for the model of development we picked
when the repo went public. It explains what we built, why we built
it, and how you (a human or an agent operator) should plug into it.

## The philosophy in one paragraph

Tournamental is an open-source project where **the orchestrator is a
human and the workers are AI agents**. Humans pick the direction,
own the spec, and decide what merges. Agents do the typing, the
testing, the per-file refactor, the brittle docs sweep, the
late-night dependency triage. The repo is laid out so an external
operator can point a swarm of agents at it and expect mergeable
work back, not a pile of drive-by garbage.

This is a deliberate inversion of the usual OSS model. We assume
that within the lifetime of this project, most lines of code
shipped into Tournamental will be authored by an AI agent under
human supervision. So we built for that.

## The six pillars that make it work

The repo is opinionated about six things, and the rest follows.

### 1. A machine-readable contract surface

`packages/spec/` is the contract. Every producer, every renderer,
every plugin, every agent reads the same TypeScript types
(`MatchInit`, `StateFrame`, `EventMessage`, `Team`). The spec is
**orchestrator-only** — agents do not modify it. This is the single
choke point that keeps a 200-agent swarm from drifting into 200
different mental models of what a "match" is.

### 2. Eight named extension points

The platform's plugin system in `packages/plugin-sdk/` exposes
exactly eight extension points (renderer, scorer, ingestSource,
identityProvider, commentaryProvider, shareCardRenderer,
oddsSource, affiliateRouter). Each one is a TypeScript interface.
Implementing one is a self-contained PR. The interfaces are small
enough that one agent can hold one in its head and produce a
correct implementation.

See [`docs/28-plugin-architecture.md`](28-plugin-architecture.md)
for the full extension-point reference.

### 3. AGENTS.md and SKILL.md at the root

[`AGENTS.md`](../AGENTS.md) at the repo root is the format every
major agent vendor's auto-loader expects (Cursor, Codex, Copilot,
Junie, Kiro, Gemini CLI, Devin, Factory, Goose, Jules, Continue —
plus Claude Code via the longer [`CLAUDE.md`](../CLAUDE.md)
companion). Six canonical sections: commands, testing, structure,
code style, git workflow, and a three-tier boundary block (do /
ask-first / never).

[`skills/`](../skills/) ships Anthropic Agent Skills files, the
second pillar in the 2026 agent-tooling landscape. Each
`SKILL.md` captures one high-leverage capability with executable
detail and a machine-verifiable acceptance section. Four skills
shipped at launch: scoring-rules, syndicate-create,
renderer-debug, mcp-tool-author. More land as the platform's
surfaces get used in the wild.

### 4. The MCP server as a runtime control plane

[`apps/mcp/`](../apps/mcp/) is the Model Context Protocol server.
It exposes 15+ tools across three tiers (public / user / admin)
with auth, audit, and a `/mcp/catalogue` endpoint. Any external
agent — Claude Desktop, Cursor, a custom bot — points itself at
`mcp.tournamental.com` and can discover Tournamental's
capabilities at runtime, with no SDK installed.

This is the difference between "Tournamental has an API" and
"Tournamental is a citizen of the agent ecosystem". The API is
the floor; the MCP server is the ceiling.

### 5. An explicit work-pickup contract

GitHub Issues with the [`agent-task`](../.github/labels.yml)
label are the canonical pickup queue. Every such issue follows a
strict template
([`.github/ISSUE_TEMPLATE/agent-task.yml`](../.github/ISSUE_TEMPLATE/agent-task.yml)):
single machine-checkable acceptance test, file path to start in,
`Refs:` pointer to the design doc, explicit "do NOT touch"
boundary, and a tier (do / ask-first). Vague issues are the #1
cause of low-quality agent PRs in 2026; this template forces
specificity at the input.

The local [`tasks/inbox/`](../tasks/) markdown kanban is
bridged to Issues by [`tools/tasks-to-issues.mjs`](../tools/tasks-to-issues.mjs)
so external bots can discover work via the standard GitHub
issues API.

### 6. A revenue split that includes the agents

Merged contributors opt into a continuous USDC revenue share via
[Drips Network](https://www.drips.network). The
[`FUNDING.json`](../FUNDING.json) at the repo root declares the
Drips list; the [drips-bridge service](../apps/drips-bridge/)
applies new weightings on every merge wave. **The operator who
ran the agent gets the credit.** Drips supports agents as
first-class identities; you don't need to be human to receive
USDC from the platform's revenue. This is the economic
reinforcement loop that makes a 200-agent swarm worth running.

See
[`docs/19-open-source-and-contributor-revenue.md`](19-open-source-and-contributor-revenue.md)
and the
[Drips Wave](https://www.drips.network/blog/posts/drips-wave-whats-launching-in-january)
programme.

## How to kick the repo into gear (operators)

You have an agent (Claude Desktop / Cursor / a custom orchestrator)
and you want it to ship code into Tournamental. The shortest path:

1. **Fork the repo, clone, open in your IDE.** The
   [`.devcontainer/`](../.devcontainer/) gets your environment to a
   working dev loop in ~30 seconds via GitHub Codespaces if you
   prefer not to install locally.
2. **Open `AGENTS.md` in your agent's context window first.** Every
   major IDE-agent reads it automatically, but if yours doesn't,
   paste it. The boundary tiers will save you a rejected PR.
3. **Pick a work surface.** Either:
   - Find an `agent-task`-labelled issue on GitHub and tell your
     agent to take it.
   - Pick an extension point in `packages/plugin-sdk/` and tell
     your agent to scaffold a plugin via
     `npm create @tournamental/app`.
   - Read [`skills/`](../skills/) and pick a skill that maps to
     what your agent is good at.
4. **Let it run.** The agent will read the docs, write the code,
   run `pnpm lint && pnpm typecheck && pnpm test`, open the PR.
5. **You review.** This is the part that does not delegate. You are
   the orchestrator — your job is direction, taste, and merge
   approval. The reviewer agent will run the security checklist
   and the conformance tests in parallel; you make the call on
   whether the change is what you wanted.

## How to push boundaries

If you want your agent to do work that is **not** a labelled task
or a plugin slot, this is where humans-at-the-helm earns its keep.

- **Propose a spec change.** Open an issue labelled `spec-change`,
  describe the new message type or scoring rule, link the use
  case. The orchestrator (the project maintainer, at present Tim)
  takes the decision; once merged, every agent across every
  operator picks up the new contract on next pull.
- **Propose a new extension point.** Eight is not a magic number.
  If the platform needs a `streamServerPlugin` or a
  `livenessProvider`, write the proposal as an `RFC-` doc under
  `docs/`. We've left RFCs explicitly open — see
  [`docs/README.md`](README.md) for the format.
- **Propose a new top-level surface.** Want to ship a Discord
  Activity that runs Tournamental syndicates inside Discord? A
  Twitch overlay? A native iOS / Android client beyond the
  Capacitor shell at [`apps/native/`](../apps/native/)? Open a
  discussion. The platform was built so that a top-level surface
  is a self-contained app, not a coupled module — adding a 17th
  `apps/<service>/` is a normal-shaped PR.
- **Run a Drips Wave.** A Wave is a one-week sprint where every
  merged PR converts to a share of a USDC pool. Anyone with a
  Drips list can fund a Wave; we will publicise yours on the
  marketing site if you run one. Tim ran the launch Wave; the
  next one is yours.

## What humans must do

Specifically. The agents handle everything else.

- **Hold the spec.** Nothing in `packages/spec/` changes without
  human review.
- **Set direction.** The roadmap in
  [`tasks/ROADMAP.md`](../tasks/) and the working sprint in
  [`tasks/inbox/`](../tasks/inbox/) are human-curated. Agents
  may propose, the orchestrator disposes.
- **Approve merges.** Reviewer agents annotate; humans approve.
- **Talk to other humans.** Press, partnerships, sponsorships,
  legal, FIFA. The agent does not negotiate.
- **Decide product taste.** Whether the new molecule colour palette
  is right is a judgement; the agent cannot have that judgement.

## What agents do best at this platform

Empirically, on this codebase, in this order:

1. **Documentation.** Cross-link, fix stale references, write
   readmes for new modules, archive old session notes. Agents are
   excellent at this and humans are bad at it.
2. **Per-file refactor with a clear acceptance test.** "Rename X
   to Y across all 47 files where it occurs." "Convert this
   callback-style API to async/await." "Replace this 200-line
   table with a generated one."
3. **Plugin authoring.** One extension point, one tested
   implementation. The plugin SDK contract is tight enough that
   the agent's output is mostly correct on first try.
4. **Test coverage.** Given a function, write the test. Given a
   bug report, write the regression test. Given a flaky test,
   diagnose and fix.
5. **Dependency hygiene.** Bump deps, run the test suite, file
   the migration for the ones that break.

## What agents are bad at (still, as of 2026-05)

So you don't ask them and get burned:

- **Visual design judgement.** They will produce a working
  component; they will not produce a beautiful one without
  multiple iteration rounds with a human in the loop.
- **Cross-service architecture.** "Add a new service that does
  X" is a human-orchestrator task; the agent implements the
  service once the surface is decided.
- **Negotiation, naming, narrative.** Names and stories are
  cultural artifacts; agents reach for cliché.
- **Knowing when to stop.** Without a tight acceptance test, an
  agent will keep iterating past the point of usefulness. The
  `agent-task` issue template's "single acceptance test" field
  is specifically to prevent this.

## Where the bottleneck moves

The classical OSS bottleneck is *throughput*: not enough humans
to write the code that the project needs. With agents that
bottleneck loosens. Two new bottlenecks emerge in its place:

- **The spec.** Every agent operator depends on the spec being
  stable and correct. Spec changes have to be slow and
  considered, because every downstream consumer breaks if they
  aren't.
- **Taste and direction.** When throughput is high, the question
  "are we building the right thing?" becomes the only question.
  This is what the orchestrator must own.

This is the bargain Tournamental is making: trade a year of
single-developer throughput for a year of orchestrator throughput
with a swarm of agents under it. We will know if it worked at the
end of FIFA World Cup 2026.

## Cross-reference

- [AGENTS.md](../AGENTS.md), [CLAUDE.md](../CLAUDE.md) — operating manuals.
- [docs/28-plugin-architecture.md](28-plugin-architecture.md) — extension points.
- [docs/19-open-source-and-contributor-revenue.md](19-open-source-and-contributor-revenue.md) — Drips integration.
- [docs/53-mcp-server.md](53-mcp-server.md), [docs/53-api-portal.md](53-api-portal.md) — runtime control plane.
- [examples/](../examples/) — minimal runnable examples.
- [skills/](../skills/) — Anthropic Agent Skills.
- [`@tournamental/create-app`](../packages/create-tournamental-app/) — scaffolder.

## License

CC-BY 4.0 — same as the rest of `docs/`.
