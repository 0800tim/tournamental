---
agent: plugin-architecture
branch: feat/plugin-architecture
worktree: .claude/worktrees/plugin-architecture
status: ready-for-review
docs:
  - docs/28-plugin-architecture.md (new)
  - docs/19-open-source-and-contributor-revenue.md
  - docs/04-renderer.md
  - docs/16-game-modes-and-scoring.md
  - docs/20-identity-humanness-bots.md
---

# 2026-05-11, Plugin architecture for an open-source-contributor ecosystem

## Why this exists

Tim is about to flip the repo public. To attract third-party contributors (especially
3D / WebGPU specialists, alternative scoring researchers, alternative ingest
authors), the core needs a clean plugin extension surface. This session lands the
SDK package, a worked reference plugin, the architecture doc, and the contributor
runbooks (README + AGENT-PROMPTS).

The bet: someone reading the README will be able to ship a renderer plugin within
a working day, get it picked up by the loader, and (if they ship under
`@tournamental-plugin/`) receive a Drips revshare. No core fork required.

## What landed

**Plugin SDK** at `packages/plugin-sdk/` (`@tournamental/plugin-sdk` v0.1.0):
- `src/index.ts`: eight capability interfaces (`renderer`, `scorer`,
  `ingestSource`, `identityProvider`, `commentaryProvider`,
  `shareCardRenderer`, `oddsSource`, `affiliateRouter`) plus `Plugin`,
  `PluginFactory`, `PluginContext`, `PluginError`. Re-exports spec types
  so plugin authors only need one runtime dep.
- `src/manifest.ts`: Zod schema for `plugin.json`. Strict mode (unknown
  fields rejected); license allow-list (Apache-2.0, MIT, BSD-2-Clause,
  BSD-3-Clause); SemVer enforced.
- `src/test-harness.ts`: `runScorerAgainstFixture`, `renderFrameToPng`,
  `runIngestAgainstFixture`, plus fixture builders that emit
  spec-conformant `MatchInit` + `StateFrame`.
- 17 unit tests across `test/manifest.test.ts` + `test/test-harness.test.ts`.
  All green.
- `README.md` with the 10-minute quickstart.

**Reference plugin** at `packages/plugins/example-cel-shaded-renderer/`
(`@tournamental-plugin/example-cel-shaded-renderer` v0.1.0):
- Implements the `renderer` capability. Mounts an overlay canvas with a
  cel-shading luminance ramp keyed to the team kits and the ball's
  pitch-side. Minimal so it's copy-pasteable.
- `plugin.json` with `dom: "unrestricted"` permission, Apache-2.0 license.
- `README.md` walking through the copy-as-template flow.

**Doc 28** at `docs/28-plugin-architecture.md`:
- 720+ lines covering motivation, all eight extension points (each with
  input/output type, determinism guarantees, plug-in location, code
  sample, and "writing your first one" recipe), the manifest schema,
  discovery + loading, sandboxing model, revenue split, versioning,
  worked example, FAQ, common mistakes the reviewer agent catches,
  debugging guide, prior-art comparison, roadmap (v0.2/v0.4/v1.0),
  glossary, and loader-lifecycle.

**Bootstrap edits**:
- `pnpm-workspace.yaml`: added `packages/plugins/*` glob.
- `README.md`: new "Build a plugin in 10 minutes" section.
- `AGENT-PROMPTS.md`: new "Plugin Author Agent" section with starter
  prompt for AI agents authoring plugins.

## What I considered and parked

- `tournamentFormat` plugins (different knockout / round-robin shapes):
  parked for v0.4 once we have 3+ tournaments live. Today the format is
  hardcoded for FIFA WC 2026 in `packages/bracket-engine`.
- `clipRecipe` plugins (override the goal / save / shootout clip
  templates): parked for v0.4 once the clip pipeline ships its first
  1000 clips.
- Sandboxed plugin runtime (WASM for scorers, Worker for renderers):
  v1.0 target. Today the trust model is "trust on review"; the
  reviewer agent checks every plugin PR.
- Database schema and API route extension points: deliberately NOT
  exposed. Plugins that need persistence beyond `PluginContext.cache`
  stand up their own DB.

## Sign-off checklist

- [x] `pnpm install` clean
- [x] `pnpm --filter @tournamental/plugin-sdk build` green
- [x] `pnpm --filter @tournamental/plugin-sdk test` green (17 tests)
- [x] `pnpm --filter @tournamental-plugin/example-cel-shaded-renderer build` green
- [x] No em-dashes (NZ English / project convention)
- [x] Doc 28 references only existing docs (04, 06, 12, 14, 16, 18, 19,
      20, 29, 30, 31, 32, 40)
- [x] License field set to Apache-2.0 on both new packages

## Open questions

- The doc references a `pnpm create @tournamental/plugin` scaffolder
  which is currently a stub. v0.2 work to make it real.
- The doc references `apps/web/lib/plugins/loader.ts` and
  `apps/api/src/plugins/loader.ts` as the loader implementation sites.
  Those don't exist yet; this PR is additive only. The actual loader
  wiring is a follow-up PR (Tim said "core does NOT need to wire them
  in yet").
- ESLint rule `no-unsanctioned-dom` mentioned in the doc as a v0.2
  ship; should be tracked in IDEAS.md.

## Next steps

- Tim reviews + merges the PR.
- Follow-up PR to wire the loader into `apps/web` and `apps/api` once
  the first external plugin is ready.
- Track v0.2 scaffolder + ESLint rule + plugin marketplace UI in IDEAS.md.
