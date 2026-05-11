# 2026-05-11 — npm-prep — @tournamental scope launch

**Status**: ready-for-review

**PR**: open via `gh pr create` from this branch.

**Branch**: `chore/tournamental-npm-prep`

## Goal

Make four workspace packages publish-ready under the `@tournamental` npm
scope so external contributors can `npm install @tournamental/<pkg>` and
build apps on top of Tournamental.

Packages in scope (task brief):

1. `packages/spec/` — rename `@vtorn/spec` -> `@tournamental/spec`.
2. `packages/bracket-engine/` — rename `@vtorn/bracket-engine` -> `@tournamental/bracket-engine`.
3. `packages/social-cards/` — rename `@vtorn/social-cards` -> `@tournamental/social-cards`.
4. `packages/plugin-sdk/` — owned by a parallel agent under task #84;
   leave a TODO if it does not exist at session start.

NOT in scope for rename (apps stay `@vtorn/*` as internal-only):
`@vtorn/web`, `@vtorn/marketing`, `@vtorn/game`, `@vtorn/avatar`,
`@vtorn/ball-physics`, `@vtorn/spec-client`, etc. They only update their
*import dep* on the three renamed packages.

## Plan

1. Per renamed package:
   - Bump `package.json` metadata (name, description, keywords, repository,
     homepage, bugs, author, licence, files, exports, engines,
     publishConfig).
   - Drop `"private": true` (these are public packages now).
   - Add `tsup` build producing dual CJS + ESM + d.ts in `dist/`.
   - Symlink/copy top-level LICENSE so the npm registry picks it up.
   - Add a `README.md` with install, 30-second usage, docs links, Drips
     contributor link (doc 19), Apache-2.0 badge.
   - Start a Keep-a-Changelog `CHANGELOG.md` at v0.1.0.
2. Rewrite every `@vtorn/spec | bracket-engine | social-cards` import
   across the monorepo to `@tournamental/<pkg>`.
3. `git grep @vtorn/(spec|bracket-engine|social-cards)` must come back
   empty (excluding playwright snapshot fixtures and historical session
   notes, which we leave alone).
4. `pnpm install` -> `pnpm -r build` -> `pnpm -r typecheck` all green.
5. `npm publish --dry-run` per package, capture tarball contents + size.
6. Top-level README migration note.
7. Open PR `chore(release): prep @tournamental/* npm packages for public
   publish`.

## Open questions

- `@tournamental/plugin-sdk` is task #84 in another worktree. Confirmed
  not present at session start -> document the convention in the PR body
  for the other agent to mirror.

## Outcome

- All three packages renamed and prepared for npm publish.
- 235 source files rewritten from `@vtorn/(spec|bracket-engine|social-cards)`
  to `@tournamental/<pkg>`. The `@vtorn` scope is retained for
  not-published workspaces (`@vtorn/web`, `@vtorn/marketing`,
  `@vtorn/game`, `@vtorn/avatar`, `@vtorn/ball-physics`,
  `@vtorn/spec-client`, and the rest of `apps/*`).
- Build output: tsup-driven dual CJS plus ESM with `.d.ts` plus `.d.mts`.
- `pnpm install`, `pnpm -r build`, `pnpm -r typecheck` all green.
- `pnpm publish --dry-run` confirms each tarball.
- Dist sizes (unpacked): spec 39 kB; bracket-engine 339 kB;
  social-cards 482 kB.
- `@tournamental/plugin-sdk` does not yet exist (task #84 in another
  agent's worktree). The conventions used here (publishConfig overrides
  pattern, tsup outExtension, README and CHANGELOG layout, LICENSE copy,
  Apache-2.0 string licence) should be mirrored when task #84 lands.

## Manual publish steps for Tim

1. Create the `@tournamental` npm org once: <https://www.npmjs.com/org/create>.
2. `npm login` interactively.
3. Run from the repo root:

   ```bash
   pnpm --filter @tournamental/spec publish --access public
   pnpm --filter @tournamental/bracket-engine publish --access public
   pnpm --filter @tournamental/social-cards publish --access public
   # Once @tournamental/plugin-sdk lands (task #84):
   pnpm --filter @tournamental/plugin-sdk publish --access public
   ```

   Use `pnpm publish` (not `npm publish`). pnpm correctly handles the
   `publishConfig` package.json field overrides we rely on to swap the
   source-mode entry points for the `dist/` ones at publish time.

## v0.2 parked

- Sourcemaps in dist (currently off so tarballs stay small).
- Automated provenance + npm publish via GitHub Actions OIDC.
- Bracket-engine reachable from a CDN UMD bundle for one-line CDN use.

