# Playbook 03 — Debugging a failing PR

> **When to use this.** CI is red. The PR was green when you pushed. Or it was never green. This playbook covers the failures we see most often, in roughly the order you'll hit them.

## First: read the actual log

`gh pr checks <number>` lists failed checks. `gh run view <run-id> --log-failed` dumps the failed step's log. Don't guess — read.

## Failure mode A — pnpm-lock.yaml drift

Symptom: CI says `ERR_PNPM_OUTDATED_LOCKFILE` or `ERR_PNPM_FROZEN_LOCKFILE`.

Cause: someone (you?) ran `pnpm install` with a different pnpm version, or added a dep but didn't commit the lockfile, or rebased and lost the lockfile change.

Fix:

```bash
pnpm install              # not `pnpm install --frozen-lockfile`
git add pnpm-lock.yaml
git commit -m "chore: update pnpm-lock.yaml after dep changes"
git push
```

If that doesn't take, your local pnpm is a different major version from CI's. CI uses pnpm 9; check with `pnpm --version`.

## Failure mode B — gitleaks / trufflehog false positive

Symptom: CI complains about a "secret" in a doc, a fixture, or a test.

Real fix:

- If it's a real secret, **rotate it immediately** and remove from git history (`git filter-repo`).
- If it's a fixture (e.g. example token in a doc), use a clearly-fake value: `sk-test-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA` rather than `sk-test-realistic-looking-blob`.

To exclude a known-safe pattern, edit `.gitleaks.toml` (root). Add a comment line in the same PR explaining why.

## Failure mode C — flaky WebSocket / SSE tests

Symptom: a test in `apps/stream-server`, `apps/wc2026-data`, or `apps/odds-ingest` passes locally but flakes on CI.

Common causes:

1. **Port collision.** Bind to port `0` and read back the assigned port from `app.server.address()` rather than hard-coding.
2. **Time race.** A test waits 10ms for a frame; on a slow runner it takes 50ms. Increase the wait *and* expose a deterministic clock.
3. **Unclosed sockets.** `afterAll` must close every WS client. A leaked socket holds the test runner open until the global timeout — Vitest will mark "did not exit cleanly".

The `ring`-buffer + `hub` pattern in `apps/stream-server` is the right shape; copy it rather than rolling your own.

## Failure mode D — typecheck fails only in the workspace runner

Symptom: `pnpm typecheck` works in your service but fails at the root.

Cause: the workspace typecheck runs every package's typecheck. If you added a new dep without updating `tsconfig.json`'s `paths` or `references`, root typecheck sees broken imports.

Fix: either update the touched package's tsconfig, or — better — run `pnpm -r --if-present run typecheck` locally before pushing.

## Failure mode E — vitest snapshot drift

Symptom: a test passes locally, fails on CI with a snapshot diff.

Cause: clock or randomness leak into the snapshot.

Fix: stub `Date.now`, stub the RNG, and re-run the test once. If the snapshot really did change intentionally, run `pnpm test -- -u` (vitest update flag) and commit the new snapshot.

## Failure mode F — `pnpm build` fails on `prestart`

Symptom: `pnpm start` for one service fails with a TS error during the `prestart` build.

Cause: a sibling app published a type change that breaks downstream consumers.

Fix: `pnpm -r build` from root surfaces the dependency order; the broken consumer is yours. Either roll forward (update your code) or escalate to the orchestrator if the change wasn't communicated.

## Failure mode G — better-sqlite3 native rebuild

Symptom: CI fails to install with `node-gyp` errors mentioning `better-sqlite3`.

Cause: better-sqlite3 ships prebuilds for major Node versions; if CI uses a Node version with no prebuild, it has to compile from source.

Fix: pin Node to the LTS used in our `engines` (Node 20). The `pnpm.onlyBuiltDependencies` array in the root `package.json` already lists `better-sqlite3` so it's allowed to run install scripts.

## Failure mode H — OpenAPI dump diff

Symptom: CI step "openapi-dumps-up-to-date" fails with a diff in `docs/api/<service>.openapi.json`.

Cause: you added or changed a route schema without re-running the dump script.

Fix:

```bash
pnpm --filter @vtorn/<service> dump-openapi
# or for everything:
pnpm -r --if-present run dump-openapi
git add docs/api/*.openapi.json
git commit -m "docs(api): regenerate openapi dumps"
```

## Failure mode I — markdown link checker

Symptom: `markdown-link-check` finds a broken relative link.

Cause: you renamed a doc; consumers still point at the old path.

Fix: `grep -rn 'old-doc-name' docs/` — fix every reference in the same PR. The hive-mind index in [`../README.md`](../README.md) is a frequent culprit.

## When everything is broken

Sometimes the right move is `git rebase main` and resolve conflicts. See [Playbook 04](04-merge-conflict-resolution.md). Don't `git reset --hard origin/main` without discussing with the orchestrator — you'll lose your work.

## Escalation

If you've spent more than ~30 minutes and haven't found root cause:

1. Drop a comment on the PR with what you've tried.
2. Tag the orchestrator.
3. Move to a different task while waiting — the queue is long.
