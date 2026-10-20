# CLAUDE.md — Orchestrator and Agent Entrypoint

> **The Hivemind**: this server's long-term memory vault lives at /srv/projects/hivemind (read its _CLAUDE.md). Log substantial sessions and decisions there automatically; load projects/tournamental/ notes early.

> **You are a code agent dropped into the Tournamental repo.** Read this first. It tells you what the project is in 30 seconds, what to build right now, what tools to use, how to coordinate with other agents, and how to leave the repo cleaner than you found it.

## What this is, in 30 seconds

**Tournamental** (tournamental.com) — a tournament prediction game built around a free-to-play core, with a 3D match-renderer watch-along, blockchain-verified prediction receipts, and a Telegram bot identity. Open source under Apache 2.0; brand and affiliate codes owned by **Tournamental**; contributors share platform revenue via Drips Network.

## Legal entity (load-bearing for legal/contact copy)

Tournamental is a **subsidiary of Growth Spurt Ltd**, a New Zealand company headquartered in **Auckland**. Single project contact: **info@tournamental.com**. Anywhere user-facing copy mentions the operating entity, registered office, or contact email, it MUST use this trio. Do not write "Tournamental Holdings" or "Wellington" anywhere user-facing. Do not split contacts into privacy@ / legal@ / hello@ / 0800tim@ etc. — single info@ mailbox.

Read [Tournamental Pitch.md](Tournamental%20Pitch.md) for the marketing one-pager. Read [README.md](README.md) for the repo layout and doc index. Read [REVIEW.md](REVIEW.md) for the current state of the design pack.

## Production runs from this checkout (read before touching anything)

The live services are systemd user units on this box that start
straight from this working tree:

| Unit | What | Port |
| --- | --- | --- |
| `tournamental-web` | apps/web, `next start` | 3300 |
| `tournamental-game` | apps/game (Fastify, SQLite) | 3360 |
| `tournamental-auth-sms` | apps/auth-sms (OTP) | 3330 |
| `tournamental-admin` | apps/admin | 3340 |
| `tournamental-odds-ingest` | apps/odds-ingest | 3341 |
| `tournamental-tournament-bot` | Telegram bot | 3350 |
| `tournamental-tunnel` | Cloudflare tunnel | n/a |

So in `/srv/projects/internal/tournamental` itself: never `git checkout`
another branch, never `pnpm install`, never build. Any of those changes
what production is serving. Do branch work in a separate worktree under
`/srv/projects/internal/tournamental-worktrees/<name>/`, symlink
`node_modules` (root and `apps/web`) from the main checkout, and run
test binaries directly (`node_modules/.bin/vitest`; `pnpm exec` in a
worktree tries to reinstall). Wrap builds and test runs in
`systemd-run --user --scope -p MemoryMax=3G`, one at a time: the box is
shared and short on memory. Restart services by unit name only
(`systemctl --user restart tournamental-web`), never by killing a
process pattern. Deploys (merge, build, restart) are Tim's call.

## Right now (October 2026)

The FIFA World Cup 2026 ran 11 June to 19 July 2026 and is over. The
state of the product today:

- **fwc2026.tournamental.com** serves the FWC 2026 app as a read-only
  archive (podium, engagement as percentages only, final standings as
  ranks, the official results bracket). Every mutating request gets a
  403; sign-in, saves, joins and pool creation are closed. `wc2026` and
  `2026wc` redirect there.
- **play.tournamental.com** is the hub while no tournament is active:
  a Rugby World Cup 2027 hero, a register-interest form (SQLite table
  `register_interest` in game.db, mirrored to HighLevel with the tag
  `rwc2027_interest`), and a personal invite link per signup
  (`/i/<code>`). Every other path on play redirects to the latest
  archive so old share links keep working.
- **tournamental.com** (apps/marketing, Astro, static) is about the
  platform, with an Archive Tournaments menu and a "Coming next: Rugby
  World Cup 2027" card.
- **The host switch** is `apps/web/lib/tournaments/registry.ts`. One
  process serves active, hub and archive modes; `middleware.ts` decides
  per hostname. Setting RWC 2027 to `active` hands play back to the
  live app. Details: docs/22 "Host modes" and docs/PROGRESS.md.

Next tournament: Rugby World Cup 2027, Australia, 1 October to
13 November 2027 (24 teams, 52 matches). Marketing starts June 2027;
picks open 1 September 2027. The marketing material, lead lists and
prize planning are not in this repository (it is public); they live in
the gitignored `docs/internal/` tree per `docs/INTERNAL-DOCS-POLICY.md`.
Engagement numbers from FWC 2026 are published only as percentages.

What to work on now, in order: the safe review and test items on the
hivemind burn board (`/srv/projects/hivemind/boards/burn-backlog.md`,
tournamental section), then IDEAS.md. Open draft PRs, never merge.

## History: the AR-FR 2022 renderer demo

The original critical path (May 2026) was a browser replay of the 2022
FIFA World Cup Final, Argentina 3-3 France (4-2 pens), from StatsBomb
open data: `apps/statsbomb-replay/` (producer), `apps/web/` (renderer),
`packages/avatar/` and `apps/mock-producer/`. The agent breakdown is in
[docs/09-agent-task-breakdown.md](docs/09-agent-task-breakdown.md), the
starter prompts in [AGENT-PROMPTS.md](AGENT-PROMPTS.md), the data plan
in [docs/11-historic-data-sources.md](docs/11-historic-data-sources.md).
The prediction game, pools, bot arena, auth and CRM work that followed
is logged in `sessions/` and docs/PROGRESS.md.

## Dev environment (get this on the box first)

```
Node:        v20+  (we use pnpm-workspaces)
pnpm:        v11 (workspace settings live in pnpm-workspace.yaml)
Python:      3.11+ (uv recommended)
ffmpeg:      4.4+
Redis:       7+    (design target, doc 12; production is SQLite today)
Postgres:    15+   (optional, for offline replay/analytics, doc 03)
Docker:      for service deployment
git:         v2.40+ with signed commits configured

Optional:
Foundry / Forge:    for smart contracts later (doc 21)
ngrok / Cloudflare Tunnel: to expose Telegram webhook in dev (doc 13)
```

The dev server already has all of this provisioned; agents do not install OS packages.

### Repo bootstrap (Phase 0 — orchestrator only)

The orchestrator agent does this **once** before parallel work begins:

```bash
# Top-level workspace
cat > pnpm-workspace.yaml <<'EOF'
packages:
  - 'apps/*'
  - 'packages/*'
EOF

# Top-level package.json with shared scripts
cat > package.json <<'EOF'
{
  "name": "vtorn",
  "private": true,
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "lint": "pnpm -r run lint",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck"
  }
}
EOF

# tsconfig base for all TS packages
cat > tsconfig.base.json <<'EOF'
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
EOF

# Make the spec consumable as a workspace package
mkdir -p packages/spec/src
cp spec/types.ts packages/spec/src/index.ts
cat > packages/spec/package.json <<'EOF'
{
  "name": "@tournamental/spec",
  "version": "0.1.1",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
EOF

# Apache + CC-BY licence files
# (use the canonical text; do not paraphrase)
curl -s https://www.apache.org/licenses/LICENSE-2.0.txt > LICENSE
curl -s https://creativecommons.org/licenses/by/4.0/legalcode.txt > docs/LICENSE-DOCS

# Git hygiene
cat > .gitignore <<'EOF'
node_modules/
.next/
dist/
.env
.env.local
*.log
.DS_Store
__pycache__/
.venv/
.uv/
*.pyc
EOF

git checkout -b setup/phase-0-bootstrap
git add -A
git commit -sm "chore: initialize pnpm workspace + spec package + licence files

Bootstrap repo per CLAUDE.md before parallel agents begin Phase 1.
Spec is now consumable as @tournamental/spec workspace package.

Refs: REVIEW.md
"
```

After Phase 0, parallel agents pick up their work per [AGENT-PROMPTS.md](AGENT-PROMPTS.md).

## Agent operations protocol (every agent every session)

Discipline is what makes this a clean open-source project anyone can contribute to. Every code-agent session follows this protocol.

### Start of session

1. **Pull latest main and rebase** — never start from stale state.
2. **Read your assigned doc(s)** — the agent prompt tells you which.
3. **Create a session note** at `sessions/<YYYY-MM-DD>_<agent-name>_<short-task>.md` with:
   - Task ID and assigned doc references.
   - Plan in 5–10 lines: what you'll do and why.
   - Open questions you have for the orchestrator (if any).
4. **Create a feature branch**: `git checkout -b <type>/<short-summary>` (e.g. `feat/statsbomb-replay-events`, `fix/renderer-lerp-jitter`).
5. **Begin work**.

### During the session

- **Update your session note** with key decisions as you make them. Future-you and future contributors read these.
- **Park out-of-scope ideas** in [IDEAS.md](IDEAS.md) — don't widen scope mid-session.
- **Use the spec types** (`@tournamental/spec`) instead of redefining shapes. The spec is the contract.
- **Do not modify the spec** unless your task explicitly says so. Spec changes are an orchestrator-only escalation.
- **Run lint + typecheck + tests locally** before each commit, not just at the end.

### End of session (sign-off)

Run the sign-off checklist (this becomes a script when somebody writes it):

```bash
# 1. Lint, typecheck, test pass
pnpm lint && pnpm typecheck && pnpm test

# 2. If touching Python:
uv run ruff check . && uv run pytest

# 3. Update session note with outcome summary, what's left, links to PR
$EDITOR sessions/<your-session-note>.md

# 4. Stage everything
git add -A

# 5. Conventional Commit per CONTRIBUTING.md
git commit -s   # opens editor; follow the template

# 6. Push and open a PR
git push -u origin HEAD
gh pr create --fill --base main \
  --body-file sessions/<your-session-note>.md \
  --label agent:<your-name>

# 7. PR triggers CI (lint + tests + security scan + spec-conformance check).
#    Reviewer agent picks it up and either approves or requests changes.
```

PR title format: `<type>(<scope>): <short summary>` — same as the commit subject.

### If the work isn't finished

That's fine. Mark the session note `status: in-progress`, push to a draft PR, and leave a clear `## Next steps` section in the note. The next session (you or another agent) picks it up.

## Commit conventions

Conventional Commits, signed:

```
feat(renderer): add player run-cycle animation FSM
fix(producer): handle StatsBomb timestamp wrapping at half-time
docs(spec): note v0.1.1 penalty events
chore(deps): bump three.js to 0.165
test(scoring): cover underdog-multiplier edge case at p<0.05
refactor(avatar): extract jersey texture into hook
perf(stream): batch state frames into 100ms windows
```

- Type required (`feat | fix | docs | chore | test | refactor | perf | ci | build | style`).
- Scope is the package or area name.
- Subject in imperative mood, no trailing period, ≤72 chars.
- Body wraps at 80 chars; explains *why* not *what* (the diff shows what).
- Footer: `Refs: doc/<n>` and `Refs: sessions/<note>` — orchestrator can trace any change.
- Sign-off line (`-s`) required for DCO.

## How agents coordinate

There is exactly one **orchestrator** at any time. The orchestrator:

- Owns the spec — never changes without explicit Tim approval.
- Reviews session notes daily.
- Reviews and merges PRs after the reviewer agent's approval.
- Triages [IDEAS.md](IDEAS.md) weekly into the next sprint.
- Updates the [README.md](README.md) and [REVIEW.md](REVIEW.md) when the design surface shifts.

Parallel **builder agents** each own one app or package directory (e.g. `apps/statsbomb-replay/` is owned by one agent). They:

- Read the relevant doc(s) per their AGENT-PROMPTS.md prompt.
- Build only inside their assigned directory.
- Consume `@tournamental/spec` for shared types.
- Do not depend on another agent's *implementation* — only on the spec's contract surface.

A **reviewer agent** ships alongside builders. It:

- Picks up open PRs.
- Runs the verification checklist in [CONTRIBUTING.md](CONTRIBUTING.md).
- Comments on the PR with findings.
- Approves or requests changes.

This is the same pattern good human OSS teams use. The agents follow it because it works — predictable handoffs, clean history, every change traceable.

## Memory and context

The orchestrator and builder agents accumulate context across sessions. Three persistence mechanisms:

1. **`sessions/`** — every session writes a short note. Future agents read recent ones to know what just happened. Limit notes to ~150 lines; older notes archive automatically (any note >30 days old moves to `sessions/archive/`).
2. **`IDEAS.md`** — backlog parking lot. Anything that emerges mid-work and isn't sprint scope goes here.
3. **`docs/`** — the canonical design pack. If a session's outcome materially changes a design, the agent updates the relevant doc *as part of the same PR*. Code without doc updates is incomplete.

Long-term reasoning context (how a feature evolved across sprints) lives in `docs/`. Short-term work-in-progress context lives in `sessions/`. The boundary is "would a new contributor next month need this to understand the codebase?" — yes → docs, no → sessions.

## Security and audits

- **No secrets in commits.** Use `.env` (gitignored) plus the deployment secret store. The reviewer agent runs `gitleaks` or `trufflehog` on every PR.
- **No copy-pasted external code without licence check.** If a snippet > ~30 lines comes from elsewhere, the agent records the source and licence in the session note and ensures the licence is compatible with Apache 2.0.
- **Smart contracts** (when we get there) ship to a testnet first, run an internal review checklist, and require an external audit before mainnet (per doc 21).
- **OWASP-flavour basic checks** on every PR via the reviewer pipeline (input validation, auth boundaries, deserialisation safety).

Full pipeline detail in [CONTRIBUTING.md](CONTRIBUTING.md).

## Running the historic AR-FR demo

Kept for the renderer path. Producer: `cd apps/statsbomb-replay && uv run
python replay.py --match=fifa-wc-2022-final-arg-fra-2022-12-18
--time-scale=10 --out=ws --port=4001`. Renderer: `cd apps/web && pnpm dev`
then open `/match/fifa-wc-2022-final-arg-fra-2022-12-18` on port 3000.
Acceptance criteria (score timeline, nameplates, 60 fps on a 2022
mid-range Android) are in docs/11. Do not run `pnpm dev` in the
production checkout; use a worktree.

## Performance and caching are paramount

Maintainer rule: **performance and caching are reviewed on every PR**. Read [docs/22-deployment-and-tunnels.md](docs/22-deployment-and-tunnels.md) for the full caching matrix and budgets. The TL;DR for every code agent:

1. **Public surfaces have an explicit cache policy.** No new route ships without one. Defaults:
   - Static asset (hashed filename): `Cache-Control: public, max-age=31536000, immutable`.
   - HTML page: `Cache-Control: no-store` unless it's marketing (then long edge cache + SWR).
   - API list/aggregate: short TTL via Redis + `s-maxage` per endpoint; `stale-while-revalidate` to absorb spikes.
   - User-specific (`/v1/me/*`): `private, no-store`.
2. **Hot reads go through Redis.** If a query is on the request hot path and is staleness-tolerant, Redis caches it. In-memory LRU on top of Redis for the hottest items (leaderboards top-10, current-match summaries).
3. **Frontend critical-path is budgeted.** LCP < 2.5s on a mid-range 2022 Android, renderer steady-state 60fps with 22 players + ball, WS lag < 250ms p95 same-continent.
4. **Measure before optimising and after changing.** A 5% perf regression with no clear win is a request-changes.

Daily review checkpoints (orchestrator + reviewer agent):

- New public surface? → cache policy chosen and matches docs/22?
- New hot read? → Redis (and/or in-memory LRU) layer in front?
- New write? → read-after-write semantics documented?
- New dep? → bundle-size justified (`next build` analyzer for client code)?
- Slowed a critical path? → measured, justified, or fixed?

## Ports and environments

Single source of truth: [docs/22-deployment-and-tunnels.md](docs/22-deployment-and-tunnels.md). Quick reference:

| Service              | Dev port | Public (prod) hostname          |
| -------------------- | -------- | ------------------------------- |
| `apps/web`           | 3300     | https://play.tournamental.com   |
| `apps/web` (archive) | 3300     | https://fwc2026.tournamental.com (read-only FWC 2026; see docs/22 host modes) |
| Producer WS          | 4001     | wss://stream.tournamental.com   |
| `apps/api`           | 3310     | https://api.tournamental.com    |
| `apps/marketing`     | 3320     | https://tournamental.com        |
| Postgres (dev)       | 5435     | localhost only                  |
| Redis (dev)          | 6380     | localhost only                  |

When you change a port, update `docs/22-deployment-and-tunnels.md` and the corresponding tunnel ingress rule in the same PR.

## Database and cache stack

Production today is SQLite: `apps/game/data/game.db` (game, pools,
register_interest) and the auth service's `auth.db`, read and written
in place by the units above. Back them up before any schema change.
The Postgres and Redis stack below is the dev and analytics design.

Postgres 16 + Redis 7, both Dockerised, brought up via `bash infra/scripts/db-up.sh`. Connection settings come from `.env` (template at `.env.example`). See:

- `infra/docker/compose.yml` — the stack.
- `infra/scripts/db-backup.sh` — hourly/daily/weekly rotation, sha256 verified, optional offsite mirror.
- `infra/scripts/db-restore.sh` — host-allowlisted, optional PII-scrub for prod-snapshot-into-staging.
- `infra/db/pii-scrub.sql` — schema-following scrub config (created when prod schema lands).

Migrations: builders pick the migration tool that fits their stack (Prisma for Node TS surfaces, plain SQL for the producer if it ever writes). Whichever tool, **migrations live in `apps/<service>/migrations/` and are checked in.** Reviewer agent rejects PRs that mutate schema without a migration.

## SDK release process (mandatory when bumping `@tournamental/bot-node`)

External users install the bot SDK via `npm i @tournamental/bot-node` or run `npx tournamental-bot-node`. **Any change to `packages/bot-node/` must follow this checklist or the published SDK drifts behind the source.** The version published to npm is the version users get; nothing automatic mirrors the source bump.

1. **Bump the version** in `packages/bot-node/package.json`. Semver: patch for bugfix, minor for additive API, **major (with a SCHEMA migration note) for any storage-layer change**. The schema is breaking by default — operators upgrading minor versions should not have to wipe their data volume.
2. **Update tests** in `packages/bot-node/test/`. `pnpm --filter @tournamental/bot-node test` must be green before publishing.
3. **Build + pack** locally: `cd packages/bot-node && pnpm run build && pnpm pack`. Produces `tournamental-bot-node-<ver>.tgz`.
4. **Smoke the dependents** (any package that consumes the tarball directly):
   - `apps/billion-bot/` — edit `package.json` + `Dockerfile` to reference the new `tournamental-bot-node-<ver>.tgz`, then `rm -rf node_modules && pnpm install && docker compose build --no-cache && docker compose up -d`. Confirm `/stats` on port 4080 reports the new version.
   - Any other consumer the orchestrator names in the session note.
5. **Publish to npm**: `npm publish --access public` from `packages/bot-node/`. Requires a token with `@tournamental/*` write scope in `~/.npmrc`. If `npm whoami` returns 401 or publish returns 404 on the scope, **stop and escalate to Tim** — do not skip this step or external users will install a stale version.
6. **Commit** the version bump + new tarball reference + updated docs in one PR titled `feat(bot-node): vX.Y.Z — <what changed>`. The body must list: the schema delta, whether operators need to wipe their data volume, and the rollback story.
7. **Announce** in `IDEAS.md` (or the launch channel post-launch) so operators know to update their `npm i` / pull the new docker image.

A schema migration that requires a wipe (e.g. v0.3.0's regenerate-on-demand collapse) **must** include an `infra/scripts/migrate-bot-node-<from>-to-<to>.md` runbook covering: (a) what to back up first, (b) the wipe commands, (c) the verification steps post-restart.

## Three things to remember

1. **Production runs from this checkout.** Branch work happens in a worktree; merge and deploy are Tim's.
2. **The spec is sacred.** Do not branch the spec. Spec changes are escalated to the orchestrator.
3. **Leave the repo cleaner than you found it.** Session notes, conventional commits, doc updates, and trimmed scope. The whole stack is open source — somebody else will read your code in three months.

Then read docs/PROGRESS.md for what shipped most recently, and
[AGENT-PROMPTS.md](AGENT-PROMPTS.md) only if you are on the renderer path.
