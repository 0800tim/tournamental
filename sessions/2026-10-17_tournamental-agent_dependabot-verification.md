# 2026-10-17, Dependabot branch verification

**Task**: burn round 5, verify the nine Dependabot branches without merging and write a merge or skip call per branch.
**Branch**: `docs/dependabot-verification` (worktree, docs only).

## Method

Per-branch `git diff` against main, each consumer's source, published engines and peer requirements from the npm registry, upstream release notes (undici 8, noble/curves 2, the five actions), CI results on the PRs and on main, and the current workflow files. Baseline test runs on the current lockfile: vstamp 86 pass, wc2026-data 147 pass. No installs: the symlinked node_modules on this box cannot exercise a lockfile change, so the bumped-version test runs are written down for bigmac.

## Calls

Merge: the five actions (#200 and #201 as a pair), and #207 @fastify/cors 11 after a Dependabot rebase (every consumer is on Fastify 5; three production units restart). Skip: #208 Capacitor android alone (peer core ^8 while the app is on 6), #206 undici 8 (needs Node 22.19 and CI pins Node 20), #209 noble/curves 2 as is (one renamed call in `apps/vstamp/src/lib/keys.ts`, take it with the rename).

## Found on the way

The Node CI job fails on `main` itself on every run since June, at the workspace typecheck step, so the red check on every Dependabot PR is inherited. Separate item.

## Outcome

`docs/reviews/2026-10-dependabot-verification.md`, draft PR opened. Needs Tim: the merges and closes in the order the review gives, and a decision on Node 22 in CI.
