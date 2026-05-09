# 34 — Orchestrator runbook

> How the parallel-agent orchestration pattern works in this repo. For Tim, future contributors, and future-orchestrators.

## Pattern: one orchestrator + N parallel builders

VTourn's build cadence is sustained at 5-10× a single dev's pace by running multiple specialised builder agents in parallel, with one orchestrator (currently Tim's primary Claude session) coordinating dispatch, merge, and triage.

```
                    ┌──────────────────┐
                    │   Orchestrator    │
                    │  (this session)   │
                    └─────────┬─────────┘
              ┌───────────────┼───────────────┐
              │               │               │
       ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
       │  Builder A   │ │  Builder B   │ │  Builder C   │
       │  worktree-1  │ │  worktree-2  │ │  worktree-3  │
       │  feat/foo    │ │  feat/bar    │ │  feat/baz    │
       └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
              │               │               │
              └───────────────┴───────────────┘
                              │
                       PR opens, CI runs
                              │
                    ┌─────────▼─────────┐
                    │  Auto-merge once   │
                    │   CI is green      │
                    └────────────────────┘
```

## Rules of engagement

### For the orchestrator

1. **Dispatch builders for any task ≥ 30min of focused work** that doesn't depend on another in-flight task.
2. **Each builder gets `isolation: worktree`** so its branch lives in its own git worktree under `.claude/worktrees/agent-<id>/`. No branch-thrashing in the main checkout.
3. **The orchestrator's working tree stays on `main`** (or a short-lived doc/fix branch). Switch back to main before dispatching new builders.
4. **Read each agent's PR before merging.** Don't trust the agent's self-summary blindly; spot-check the diff.
5. **Use auto-merge with `--admin` only when CI is green.** Never on red.
6. **Parallel-safe scoping**: each builder owns disjoint files. If two builders need the same file, sequence them (one waits on the other's merge).
7. **5-10 builders max in flight at once.** More than that and the orchestrator can't keep up with merge triage.
8. **Keep main green.** Never leave a broken main.

### For builder agents

1. **Read CLAUDE.md first.** Every time. The repo's discipline rules.
2. **Branch from `origin/main`**, not from another in-flight branch.
3. **One concern per PR.** Don't bundle.
4. **DCO sign-off + Conventional Commits** are non-negotiable.
5. **Tests must pass before push.** Run `pnpm lint && pnpm typecheck && pnpm test` locally first.
6. **If you discover a bug not in your scope, document it; don't fix it.** Open an issue or note in `IDEAS.md`. Stay scoped.
7. **Report back with**: PR URL, commit SHAs, test counts, screenshots/curl-outputs, open questions, deferred items.

### Conflict resolution

When a PR has lockfile or middleware conflicts:

```bash
git switch <branch>
git fetch origin main
git rebase origin/main
# resolve conflicts; for pnpm-lock.yaml, take --theirs and re-run pnpm install
git checkout --theirs pnpm-lock.yaml
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml
git rebase --continue
git push --force-with-lease
```

For `apps/web/middleware.ts` conflicts where multiple agents add host-aware logic — manually merge both rule sets in.

### Worktree hygiene

```bash
# List all current worktrees:
git worktree list

# Remove a worktree after its branch merges:
git worktree remove .claude/worktrees/agent-<id> --force
git branch -D <branch-name>

# Stuck rebase state (clean up after agent crashes):
rm -rf .git/rebase-merge .git/rebase-apply
git rebase --abort
```

## Anti-patterns (don't do these)

- **Don't dispatch a builder to fix a bug another builder will hit.** Sequence them.
- **Don't dispatch a builder without a clear scope doc.** Vague prompts produce vague PRs.
- **Don't merge a PR that touches files outside its declared scope** without re-reading the prompt.
- **Don't auto-merge PRs that touch security-sensitive paths** (`apps/auth-sms`, `apps/admin`, `infra/`). Tim or a human reviewer signs off.
- **Don't share a port across worktrees.** `pnpm dev` on :3300 from worktree A blocks worktree B. Use `PORT=3301` overrides.
- **Don't leave a dev server running on the wrong checkout** — the production tunnel's HTTP origin is whatever's listening. If a builder agent's worktree captures :3300, hard-kill it and restart from main.

## Coordination signals

| Signal | Meaning |
| --- | --- |
| Builder reports PR URL + "MERGEABLE" | Auto-merge candidate |
| Builder reports PR URL + "DIRTY" or merge conflicts | Orchestrator rebases on its behalf |
| Builder reports "no completion / agent timed out" | Orchestrator commits the staged work and opens PR |
| CI red on green PR | Orchestrator inspects logs; either fixes lockfile / config inline OR re-dispatches |
| Tim hits the live URL and reports a bug | Orchestrator triages; if scope <30min, fixes inline; otherwise dispatches a focused fix-agent |

## Escalation rules

| Escalate to Tim if... | Don't escalate (handle yourself) |
| --- | --- |
| A PR touches the spec (`packages/spec`) | Lockfile conflicts |
| A PR touches `infra/` Cloudflare config | UI tweaks |
| Auth or KYC flow change | Bug fixes <30min |
| Affiliate program registration choice | Documentation gaps |
| Brand identity change | Test additions |
| External-service credential needed | Internal tool selection |

## Performance + caching review

Per CLAUDE.md (project rule, every PR):

- New public surface? → cache policy chosen and matches `docs/22`?
- New hot read? → Redis + in-memory LRU?
- New write? → read-after-write semantics documented?
- New dep? → bundle-size justified?
- Slowed a critical path? → measured, justified, or fixed?

The orchestrator must check these before merging any PR that touches a public route.

## Daily log expectations

The orchestrator maintains:

- **`sessions/<YYYY-MM-DD>_<topic>.md`** for each work block (~150 lines max).
- **`docs/32-overnight-sprint-runbook.md`** updated as a live tracker.
- **`IDEAS.md`** triaged weekly (parking lot for out-of-scope ideas).
- **`docs/`** updated with every doc-affecting PR.

## When the orchestrator is offline

Tim or another contributor takes over. The pattern is:

1. Read `docs/32-overnight-sprint-runbook.md` (or latest sprint runbook).
2. Read recent session notes.
3. Read open PR descriptions.
4. Check live URLs against the morning checklist.
5. Merge any green PRs that aren't security-sensitive.
6. Triage open agent reports.
7. Note any blockers and either escalate or unblock.

## Glossary

- **Orchestrator**: the always-on Claude session that dispatches and triages.
- **Builder**: a focused agent with `isolation: worktree` and a one-PR scope.
- **Reviewer**: an agent that runs the verification checklist on a PR (per `CONTRIBUTING.md`).
- **Worktree**: an isolated git working directory under `.claude/worktrees/agent-<id>/`.
- **Auto-merge**: `gh pr merge --squash --delete-branch --admin` after CI is green.
