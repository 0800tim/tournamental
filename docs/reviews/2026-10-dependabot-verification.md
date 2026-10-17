# Dependabot branches: verification and merge or skip calls

> Read-only review, 2026-10-17, against `main` at e1e0eac9. Nine Dependabot PRs opened on 2026-06-16 (#200 to #204 GitHub Actions, #206 to #209 npm). Nothing merged, nothing installed; the npm calls are made from each consumer's source, the packages' published engine and peer requirements, and the upstream release notes. The tests named below ran on the current lockfile as a baseline; running them on the bumped versions needs a fresh install and is left for bigmac.

## Two facts that apply to all nine

- **The CI failure on every one of them is inherited.** All nine show "Node, install / lint / typecheck / test / build: FAILURE". `main` itself has failed that job on every run since June, including 2026-10-15 (e1e0eac9), at the "Typecheck (--if-present across workspace)" step. The red check says nothing about the bumps. Fixing the workspace typecheck is its own item.
- **The four npm PRs are conflicting** and cannot be merged as they stand. They were cut before the pnpm 11 lockfile change (256d80b8), so `pnpm-lock.yaml` conflicts in every one. Dependabot recreates the branch on request (a `@dependabot rebase` comment on the PR; not sent by this review). Nothing needs to be hand-merged.

## npm

| PR | Branch | Scope on main today | Call |
| --- | --- | --- | --- |
| #206 | `undici-8.3.0` | `apps/wc2026-data` (^6.20.1), `apps/odds-ingest` and `apps/dm-poll-forwarder` (^7.1.0) | **Skip for now**: undici 8 requires Node 22.19 or newer; CI pins Node 20 |
| #207 | `fastify/cors-11.2.0` | 16 Fastify apps, all on fastify ^5 | **Merge after rebase** |
| #209 | `noble/curves-2.2.0` | `apps/vstamp` only | **Skip until the code is updated**: one renamed call |
| #208 | `capacitor/android-8.3.4` | `apps/native` only | **Skip**: peer `@capacitor/core ^8.3` while everything else is on 6 |

### #206 undici 6.25.0 to 8.3.0

Three apps import `request` from undici (`apps/wc2026-data/src/live/*-provider.ts`, `settlement-bridge.ts`; odds-ingest and dm-poll-forwarder likewise). The v8 release notes list no change to `request`; the breaking items are HTTP/2 on by default, removal of legacy handler wrappers and non-real Blob objects. The blocker is runtime: `undici@8.3.0` declares `engines.node >= 22.19.0`. The box runs Node 22.22.1 (fine), but `ci.yml` and `build-and-deploy.yml` use `node-version: 20`, so CI would fail to install. Two sane paths: bump CI to Node 22 first and then take undici 8 (HTTP/2 default is worth a smoke test against API-Football and Sportradar), or ask Dependabot for the 7.x line instead, which the other two apps already use and which still receives fixes. `apps/wc2026-data` is the one app still on 6.x; lifting it to ^7 is the low-risk move either way. Baseline: `apps/wc2026-data` 147 tests pass on 6.25.

### #207 @fastify/cors 10.1.0 to 11.2.0

@fastify/cors 11 is the Fastify 5 line. Every consumer declares `fastify ^5.0.0` or newer, so the peer requirement is met and the bump removes a version skew rather than adding one. The plugin's options did not change between 10 and 11 beyond the peer bump. Production impact: `tournamental-game`, `-auth-sms` and `-odds-ingest` carry it, so merging means a `pnpm install` on the main checkout and a restart of those three units at a quiet time. Verify on bigmac with `pnpm --filter @vtorn/game test`, `pnpm --filter @vtorn/auth-sms test` and `pnpm --filter @tournamental/odds-ingest test` after the rebase.

### #209 @noble/curves 1.9.7 to 2.2.0

`apps/vstamp/src/lib/keys.ts` calls `ed25519.utils.randomPrivateKey()`, `getPublicKey`, `sign` and `verify`. The 2.0.0 notes rename `randomPrivateKey` to `randomSecretKey` and prohibit hex-string inputs (Uint8Array only). The rename makes the current code throw at key generation; the inputs are already `Uint8Array` in vstamp. So: skip the PR as is, and take it with a one-line change to `randomSecretKey()` in the same PR (plus the `test/keys.test.ts` expectation if it names the function). Engines: Node 20.19 or newer, fine on both CI and the box. Baseline: `apps/vstamp` 86 tests pass on 1.9.7.

### #208 @capacitor/android 6.2.1 to 8.3.4

`@capacitor/android@8.3.4` peers on `@capacitor/core ^8.3.0`; `apps/native` pins every Capacitor package, including core, cli and ios, at ^6. Bumping android alone cannot install. A Capacitor 6 to 8 move is a coordinated upgrade of all nine packages plus the native project files, and `apps/native` is not in production. Skip and close; revisit when the native shell is next worked on.

## GitHub Actions

All five move the action to the Node 24 runtime. Every workflow here runs on `ubuntu-latest` (29 jobs, no self-hosted runners), so the runner version requirement (2.327.1 or newer) is met by GitHub.

| PR | Bump | Where used | Call |
| --- | --- | --- | --- |
| #200 | `actions/upload-artifact` 4 to 7 | `pr-security.yml` (8 steps), `security-watchdog.yml`, `build-and-deploy.yml` | **Merge, together with #201** |
| #201 | `actions/download-artifact` 4 to 8 | `pr-security.yml` roll-up job | **Merge, together with #200** |
| #202 | `actions/github-script` 8 to 9 | `scaffolder-staleness.yml` | **Merge** |
| #204 | `crazy-max/ghaction-github-labeler` 5 to 6 | `labels-sync.yml` | **Merge** |
| #203 | `google/osv-scanner-action` 1.9.2 to 2.3.8 | `pr-security.yml`, `security-watchdog.yml` | **Merge, then watch one run** |

- **#200 and #201** go in as a pair: the roll-up job downloads what the scan jobs upload in the same workflow, and the v8 downloader checks the artifact's content type before unzipping (its "enforced checks" note), which is exactly what the v7 uploader produces. Taking only one of the two is the one way to break `pr-security.yml`.
- **#202** github-script v9 is the Node 24 runtime change only; the one script in `scaffolder-staleness.yml` uses the `github` and `core` objects, unchanged.
- **#204** labeler v6 is the Node 24 runtime change only; `labels-sync.yml` passes a YAML file path, unchanged input.
- **#203** osv-scanner v2 keeps the `osv-scanner-action/osv-scanner-action` path and the `scan-args` input used in both workflows. The scanner CLI itself moved a major; the flags we pass (`--recursive`, `--skip-git`, `--format=json`, `--output=...`) still exist in v2. Google's note recommends their reusable workflows over the bare action because the bare action can change in minor releases; worth a look when the security workflows are next touched. Watch the first scheduled `security-watchdog.yml` run after merging.

## Suggested order for Tim

1. Merge #200 and #201 together, then #202, #204, #203 (docs-only risk, no deploy).
2. Ask Dependabot to rebase #207 and merge it; install on the main checkout and restart `tournamental-game`, `-auth-sms`, `-odds-ingest` at a quiet time; the three test suites first on bigmac.
3. Close #208.
4. Replace #209 with a small PR that bumps `@noble/curves` to ^2.2 and renames the call in `apps/vstamp/src/lib/keys.ts`; run `apps/vstamp` tests.
5. Decide Node 22 in CI; until then close #206 and let Dependabot propose 7.x for `apps/wc2026-data`.

## What to run on bigmac before each npm merge

From a fresh worktree on the rebased branch, with a real `pnpm install --frozen-lockfile` (the symlinked-node_modules trick used on this box cannot exercise a lockfile change):

```bash
pnpm --filter @vtorn/vstamp test          # #209, 86 cases on 1.9.7 today
pnpm --filter @vtorn/wc2026-data-scripts test   # #206, 147 cases on 6.25 today
pnpm --filter @vtorn/game test && pnpm --filter @vtorn/auth-sms test && pnpm --filter @tournamental/odds-ingest test   # #207
```

Package names are from each app's `package.json` (`@vtorn/vstamp`, `@vtorn/wc2026-data-scripts`, `@vtorn/game`, `@vtorn/auth-sms`, `@tournamental/odds-ingest`).
