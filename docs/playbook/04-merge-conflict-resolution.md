# Playbook 04 — Merge conflict resolution

> **When to use this.** Your branch has diverged from `main` and `git rebase main` reports conflicts. Or another agent's PR landed first and you need to integrate.

## Default flow: rebase, not merge

We rebase. The repo history reads top-to-bottom as a sequence of self-contained features.

```bash
git fetch origin
git rebase origin/main
# resolve conflicts (see below)
git push --force-with-lease   # never plain --force
```

`--force-with-lease` will refuse to overwrite the remote if someone else pushed since your last fetch — a small but important seatbelt.

## Resolving conflicts in code files

Always read both sides. The temptation to take one wholesale and move on is how you lose work.

```bash
git diff --name-only --diff-filter=U   # list conflicting files
$EDITOR <file>                         # resolve manually
git add <file>
git rebase --continue
```

For files with many small conflicts, the merge tool helps: `git mergetool` (configure via `git config merge.tool` once).

## --theirs vs --ours decisions

`--theirs` and `--ours` are *almost never* the right call for source code. They are appropriate for:

| Situation | Use |
| --- | --- |
| Conflicts in `pnpm-lock.yaml` | `--theirs` (then re-run `pnpm install` to settle) |
| Conflicts in committed `dist/` (shouldn't exist — we gitignore dist) | delete and rebuild |
| Conflicts in `package.json` `dependencies` ordering | manually merge — order doesn't matter, keep both adds |
| Conflicts in `docs/api/*.openapi.json` (generated) | regenerate after rebase via `pnpm --filter <pkg> dump-openapi` |
| Conflicts in markdown TOC sections | manually merge both — both contributions are usually wanted |
| Conflicts in `.astro` build artefacts | gitignore them (they shouldn't be tracked); delete and let the build regenerate |

When you reach for `--theirs` or `--ours`, write a one-line note in your session log explaining why.

## Generated files

The repo treats some generated files as committed (so consumers don't have to build first):

- `docs/api/*.openapi.json` — regenerate after rebase: `pnpm -r --if-present run dump-openapi`
- `pnpm-lock.yaml` — let pnpm re-resolve: `pnpm install` after taking `--theirs`
- `packages/*/dist/` — never tracked. If a sibling agent committed dist artefacts by accident, delete them in your PR and add to .gitignore in the same commit.

If a build artefact appears in the conflict list, your first move is "should this even be tracked?". Often the answer is no.

## Migrations

Two PRs both touching `apps/<service>/migrations/` is a recipe for primary-key collisions. The convention:

- Migrations are timestamp-prefixed (`20260511T0930_add-foo-table.sql`). Two agents picking the same minute is rare — but if it happens, the *second* PR to land bumps its timestamp by a minute and re-orders.
- Never `git rebase --interactive --autosquash` migrations. They're append-only.

## Generated documentation

If you and a sibling agent both wrote new sections to `docs/README.md` or `glossary.md`, the merge is almost always *both* — manually combine the sections. Do not pick one.

## When the rebase is bigger than the work

If you've been on a branch for more than a couple of days and `main` has moved by 50+ commits, sometimes the cleanest move is:

```bash
# Stash your work as a series of patches
git format-patch origin/main..HEAD -o /tmp/my-work
# Reset to main
git reset --hard origin/main
# Apply patches in order, resolving as you go
git am /tmp/my-work/*.patch
```

This gives you per-commit conflict resolution rather than the rebase's "all at once" interface. Useful for big feature branches.

## After the rebase

```bash
pnpm install                                          # re-settle lockfile
pnpm typecheck                                        # workspace clean
pnpm test                                             # everything still passes
pnpm -r --if-present run dump-openapi                 # regenerate openapi
git add docs/api/                                     # commit dump changes
git commit -m "docs(api): regenerate after rebase"    # if anything changed
git push --force-with-lease
```

## What you do not do

- Do not `git merge main` and create a merge commit. Our history is linear.
- Do not `git rebase -i` in CI/orchestrator scripts. Interactive rebase is for humans.
- Do not skip the post-rebase `pnpm install`. The lockfile may have settled differently after the rebase resolved its conflicts.
- Do not push `--force` (without `--with-lease`) to a shared branch. Use `--force-with-lease` always.
