# AGENTS.md

> Operating manual for AI coding agents (Claude Code, Cursor, Codex,
> Copilot, Junie, Kiro, Gemini CLI, Devin, Factory, Goose, Jules, Continue)
> working inside the Tournamental repo.
>
> Companion to [CLAUDE.md](CLAUDE.md), which is the longer human-oriented
> orchestrator brief. This file is the short, structured one every
> agent-tool-vendor's auto-loader expects to find at the repo root.

## What this project is, in 60 seconds

[**Tournamental**](https://tournamental.com) is an open-source FIFA World
Cup prediction game. Three surfaces:

- **`apps/marketing/`** — [tournamental.com](https://tournamental.com), Astro 4 marketing site.
- **`apps/web/`** — [play.tournamental.com](https://play.tournamental.com), Next.js 14 App Router bracket app + 3D match renderer.
- **`apps/game/`** + ~16 other Fastify services — game-service, identity, vstamp, odds-ingest, mcp, etc. See [docs/22-deployment-and-tunnels.md](docs/22-deployment-and-tunnels.md) for the full port table.

Apache 2.0. Contributors share platform revenue via [Drips Network](https://www.drips.network/).
Detail: [docs/19-open-source-and-contributor-revenue.md](docs/19-open-source-and-contributor-revenue.md).

## Commands

```bash
# One-time setup
pnpm install                   # installs every workspace package
bash infra/scripts/db-up.sh    # Postgres 5435 + Redis 6380 in Docker

# Develop
pnpm dev                       # runs every package's `dev` script in parallel
pnpm --filter @vtorn/web dev   # just the bracket app on :3300
pnpm --filter @vtorn/marketing dev  # just the marketing site on :3320

# Validate (run before every commit)
pnpm lint
pnpm typecheck
pnpm test

# Python surfaces (apps/statsbomb-replay, apps/wc2026-data)
uv run ruff check .
uv run pytest

# Single test file
pnpm --filter @vtorn/web test -- AppMenuDrawer
```

## Testing

- **JS/TS**: [vitest](https://vitest.dev) 2.x across the monorepo. Test files live next to source as `*.test.ts(x)` or under `__tests__/`. **Do not** bump to vitest 4 yet — skip-major breaks the in-repo configs ([IDEAS.md](IDEAS.md)).
- **Python**: pytest under [uv](https://docs.astral.sh/uv/), one Python venv per app.
- **Integration**: `apps/web/playwright-tests/` runs against a started dev server.
- **Coverage budget**: new modules should ship with tests. Bug fixes ship with a regression test that fails on `main`.
- **Before opening a PR**: `pnpm lint && pnpm typecheck && pnpm test` all green. CI runs them again — don't rely on CI catching what you can catch locally.

## Project structure

```
apps/             # Runtime services + frontends
  web/            # Next.js bracket app + 3D renderer
  marketing/      # Astro marketing site + blog + /api portal
  game/           # Fastify game service (SQLite at apps/game/data/game.db)
  auth-sms/       # OTP issuance via Aiva SMS / WhatsApp / Telegram
  identity/       # Identity + humanness score
  mcp/            # Model Context Protocol server (apps/mcp/.env)
  api/            # Umbrella API surface
  ... 16 services total
packages/         # Shared libraries (workspace-published)
  spec/           # @tournamental/spec — message types (DO NOT MODIFY)
  bracket-engine/ # @tournamental/bracket-engine — scoring + cascade
  plugin-sdk/     # @tournamental/plugin-sdk — 8 extension points
  social-cards/   # @tournamental/social-cards — OG / podium / share-card SVG
packages/plugins/ # First-party plugin examples (study these first)
docs/             # Canonical design pack (numbered 01..56)
sessions/         # Session notes — write one per work session
examples/         # Minimal runnable examples for new contributors
infra/            # Docker compose, db migrations, Cloudflare scripts
```

## Code style

- TypeScript strict mode. ESM modules. Target ES2022.
- **No em-dashes** — Tim's strong preference. Use commas or standard hyphens. The marketing-side em-dash sweep at [PR #77](../../pull/77) enforces this.
- **NZ English** — colour, behaviour, organisation. The marketing copy is the reference.
- Prefer pure functions; isolate side effects at the edges.
- **No comments that restate the code.** Only write comments that capture *why* — a hidden constraint, a workaround, a non-obvious invariant.
- **No new files unless necessary** — extend existing files first.
- **Use existing patterns.** If the codebase has a way to do something, follow it. The spec types (`@tournamental/spec`) are the contract surface.

## Git workflow

- **Branch naming**: `<type>/<short-summary>` — `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`, `test/`, `perf/`, `ci/`, `build/`.
- **Conventional Commits** required: `feat(renderer): add run-cycle FSM`. Subject ≤72 chars, body wraps at 80.
- **Sign-off (`-s`) is mandatory** for DCO.
- **Author email**: `0800tim@gmail.com` for every commit (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- **One PR per change**. Don't bundle drive-by fixes into feature PRs.
- **Open PRs against `main`**. Squash-merge on green CI.
- Every PR body has: a `## Summary` (1-3 bullets) and a `## Test plan` (checklist of what you ran).

## Boundaries — what an agent SHOULD do

- Fix bugs in the directory you've been assigned, or in `apps/<single-service>/` if you're working freelance.
- Add tests for new code.
- Update the relevant `docs/NN-*.md` in the same PR as material changes.
- Append session notes to `sessions/<YYYY-MM-DD>_<agent>_<task>.md`.
- Promote out-of-scope ideas into [IDEAS.md](IDEAS.md) instead of widening scope.

## Boundaries — ASK FIRST before doing

- Touching any file under `packages/spec/` — the spec is the cross-agent contract. Spec changes are orchestrator-only.
- Adding a new top-level `apps/<service>/` — discuss the port assignment ([docs/22](docs/22-deployment-and-tunnels.md)) first.
- Adding a new top-level dependency to `package.json` — bundle size matters; we measure on every PR.
- Migrating Postgres or SQLite schemas without a checked-in migration file under `apps/<service>/migrations/`.
- Modifying `.github/workflows/`, `infra/cloudflare/`, or `infra/docker/`.

## Boundaries — NEVER do

- **Never modify or delete** files in `.env*` — secrets live there.
- **Never** commit `.env` files (gitignored).
- **Never** weaken security (`--no-verify`, `--no-gpg-sign`, removing CSP headers, broadening CORS without justification).
- **Never** force-push to `main` or rewrite history on a shared branch.
- **Never** introduce a new external service call without it going through an existing client in `packages/` (e.g. `packages/aiva-client` for SMS).
- **Never** print or log secrets, including in error messages.
- **Never** publish an npm package without the `chore(release):` PR template + maintainer review.

## How to find work

Three labels on [GitHub Issues](https://github.com/0800tim/tournamental/issues):

- **`good first issue`** — for humans new to the project. Single file, single test, well-scoped.
- **`agent-task`** — explicitly structured for AI agents to pick up. Each one has:
  - a single, machine-checkable acceptance test,
  - a file path to start in,
  - a `Refs: docs/NN-*.md` pointer to the relevant design doc,
  - an explicit "this should NOT touch: …" boundary.
- **`spec-change`** — orchestrator-only.

[IDEAS.md](IDEAS.md) is the backlog parking lot. Triaged weekly into the
sprint that follows. Bots may suggest promotions but the orchestrator
opens the issue.

## Cross-reference

- [CLAUDE.md](CLAUDE.md) — longer orchestrator brief with full philosophy.
- [CONTRIBUTING.md](CONTRIBUTING.md) — human contributor guide (DCO, code of conduct).
- [docs/55-public-launch-checklist.md](docs/55-public-launch-checklist.md) — pre-public-flip operator checklist.
- [docs/28-plugin-architecture.md](docs/28-plugin-architecture.md) — plugin extension points + manifest schema.
- [docs/53-mcp-server.md](docs/53-mcp-server.md) — MCP tools, auth tiers, audit log.
- [docs/53-api-portal.md](docs/53-api-portal.md) — aggregated OpenAPI portal at tournamental.com/api.
- [examples/](examples/) — minimal runnable examples to fork from.
- [skills/](skills/) — Anthropic Agent Skills format (SKILL.md) for high-leverage capabilities.

## License

Code: Apache 2.0. Docs: CC-BY 4.0. See [LICENSE](LICENSE) and
[docs/LICENSE-DOCS](docs/LICENSE-DOCS).
