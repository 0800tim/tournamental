# CLAUDE.md — Orchestrator and Agent Entrypoint

> **You are a code agent dropped into the VTorn repo.** Read this first. It tells you what the project is in 30 seconds, what to build right now, what tools to use, how to coordinate with other agents, and how to leave the repo cleaner than you found it.

## What this is, in 30 seconds

**VTorn** (vtorn.com) — a tournament prediction game built around a free-to-play core, with a 3D match-renderer watch-along, blockchain-verified prediction receipts, and a Telegram bot identity. Open source under Apache 2.0; brand and affiliate codes owned by **VTorn Holdings**; contributors share platform revenue via Drips Network.

Read [VTorn Pitch.md](VTorn%20Pitch.md) for the marketing one-pager. Read [README.md](README.md) for the repo layout and doc index. Read [REVIEW.md](REVIEW.md) for the current state of the design pack.

## Right now (the AR-FR 2022 critical path)

**Goal**: get the **2022 FIFA World Cup Final, Argentina 3–3 France (4–2 pens)** rendering in a browser, end-to-end, in under one working week. This is the v0.1 demo.

Skip everything that isn't on this path. The full agent breakdown in [docs/09-agent-task-breakdown.md](docs/09-agent-task-breakdown.md) lists 16 agents (A–P); only four of those are on the critical path right now:

1. **`apps/statsbomb-replay/`** (Python) — converts StatsBomb open data for the AR-FR final into a spec stream. See [docs/11-historic-data-sources.md](docs/11-historic-data-sources.md).
2. **`apps/web/`** (Next.js + React Three Fiber) — connects to the producer's stream and renders a watchable 90-min + extra-time + penalty match. See [docs/04-renderer.md](docs/04-renderer.md).
3. **`packages/avatar/`** + assets in `apps/web/public/` — procedural body GLB, runtime jersey-texture generator, billboard faces from Wikidata for the 22 starters. See [docs/07-avatars-and-assets.md](docs/07-avatars-and-assets.md).
4. **`apps/mock-producer/`** (Node TS) — a synthetic match for renderer dev. See [docs/05-mock-producer.md](docs/05-mock-producer.md).

Concrete starter prompts for each are in [AGENT-PROMPTS.md](AGENT-PROMPTS.md). Read those next.

## After the AR-FR demo works

Phase 2 begins as soon as the renderer + producer pair plays the 2022 final correctly. The work fans out into the rest of the agent matrix in [docs/09-agent-task-breakdown.md](docs/09-agent-task-breakdown.md):

- **Stream server + CDN** (agents C, G; docs 03, 08) — required before more than a handful of viewers.
- **Game service + flat-file leaderboards** (agent J; doc 12) — required for the prediction game.
- **Tournament Bot** (agent K; doc 13) — required for free-tier auth and push.
- **VStamp service** (agent M; doc 17) — required for the "verified" marketing claim.
- **Identity + Humanness Score** (agent O; doc 20) — required for friend leaderboards and bot policy.
- **Clip pipeline** (agent L; doc 14) — required for social distribution.
- **Affiliate router** (agent N; doc 18) — required before any revenue.
- **On-chain Pool + Oracle** (agent P; doc 21) — required for trustless settlement; gated on smart-contract audit.

These can all begin **in parallel** as soon as the spec is proven against AR-FR.

## Dev environment (get this on the box first)

```
Node:        v20+  (we use pnpm-workspaces)
pnpm:        v9+
Python:      3.11+ (uv recommended)
ffmpeg:      4.4+
Redis:       7+    (for game-service hot KV, doc 12)
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
  "name": "@vtorn/spec",
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
Spec is now consumable as @vtorn/spec workspace package.

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
- **Use the spec types** (`@vtorn/spec`) instead of redefining shapes. The spec is the contract.
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
- Consume `@vtorn/spec` for shared types.
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

## How to run the AR-FR demo (target end-state)

When the four critical-path agents have shipped:

```bash
# In one terminal — run the StatsBomb-replay producer
cd apps/statsbomb-replay
uv run python replay.py \
  --match=fifa-wc-2022-final-arg-fra-2022-12-18 \
  --time-scale=10 \
  --out=ws --port=4001

# In another terminal — run the renderer
cd apps/web
pnpm dev
# open http://localhost:3000/match/fifa-wc-2022-final-arg-fra-2022-12-18

# Optional third terminal for synthetic-data dev:
cd apps/mock-producer
pnpm start -- --seed=42 --out=ws --port=4002
```

The renderer reads from the WebSocket the producer emits on. At `time-scale=10`, the 2.5-hour AR-FR final (incl. ET and pens) plays in 15 minutes — perfect for development and shareable demos. At `time-scale=1`, real-time replay.

## What "done" looks like for the AR-FR demo

- Hits the criteria in [docs/11-historic-data-sources.md](docs/11-historic-data-sources.md):
  - HUD score matches the actual final exactly: 1–0 Messi (23'), 2–0 Di María (36'), 2–1 Mbappé (80' pen), 2–2 Mbappé (81'), 3–2 Messi (108'), 3–3 Mbappé (118' pen), then penalties Argentina 4–2.
  - Player nameplate floats over the right body for the right events.
  - Ball ends up in the goal on goals; flies toward the keeper on shots.
  - Total runtime ≤ 2.5 hours at `--time-scale=1`, ≤ 15 min at `--time-scale=10`.
- Renders at 60fps on a mid-range 2022 Android in the browser.
- Audio mix plays commentary cues at goals and shootout attempts.
- A 30-second screen recording of the demo is shareable on social.

## Performance and caching are paramount

Tim's standing rule: **performance and caching are reviewed on every PR**. Read [docs/22-deployment-and-tunnels.md](docs/22-deployment-and-tunnels.md) for the full caching matrix and budgets. The TL;DR for every code agent:

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

| Service              | Dev port | Dev URL                         |
| -------------------- | -------- | ------------------------------- |
| `apps/web`           | 3300     | https://vtorn.aiva.nz           |
| Producer WS          | 4001     | wss://vtorn-stream.aiva.nz      |
| `apps/api`           | 3310     | https://vtorn-api.aiva.nz       |
| `apps/marketing`     | 3320     | https://vtorn-www.aiva.nz       |
| Postgres (dev)       | 5435     | localhost only                  |
| Redis (dev)          | 6380     | localhost only                  |

When you change a port, update `docs/22-deployment-and-tunnels.md` and the corresponding tunnel ingress rule in the same PR.

## Database and cache stack

Postgres 16 + Redis 7, both Dockerised, brought up via `bash infra/scripts/db-up.sh`. Connection settings come from `.env` (template at `.env.example`). See:

- `infra/docker/compose.yml` — the stack.
- `infra/scripts/db-backup.sh` — hourly/daily/weekly rotation, sha256 verified, optional offsite mirror.
- `infra/scripts/db-restore.sh` — host-allowlisted, optional PII-scrub for prod-snapshot-into-staging.
- `infra/db/pii-scrub.sql` — schema-following scrub config (created when prod schema lands).

Migrations: builders pick the migration tool that fits their stack (Prisma for Node TS surfaces, plain SQL for the producer if it ever writes). Whichever tool, **migrations live in `apps/<service>/migrations/` and are checked in.** Reviewer agent rejects PRs that mutate schema without a migration.

## Three things to remember

1. **Ship the AR-FR demo first.** Everything else is enabled by it.
2. **The spec is sacred.** Do not branch the spec. Spec changes are escalated to the orchestrator.
3. **Leave the repo cleaner than you found it.** Session notes, conventional commits, doc updates, and trimmed scope. The whole stack is open source — somebody else will read your code in three months.

Now read [AGENT-PROMPTS.md](AGENT-PROMPTS.md) for the actual starter prompts.
