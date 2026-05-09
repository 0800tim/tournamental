# Social distribution kit — initial build

**Branch**: `feat/social-distribution-kit`
**Base**: `feat/marketing-site-v0-clean` (the marketing site is referenced and needs OG wiring)
**Worktree**: `/home/clawdbot/clawdia/projects/vtorn-social/` (isolated from concurrent agents)
**Builder**: social-distribution-kit agent
**Date**: 2026-05-09

## Mission

Ship the assets, code, and docs that turn VTourn's auto-clip pipeline into an end-to-end
social distribution machine. The pipeline (doc 14) is the engine; this session builds the
*templates and the strategy* that engine consumes:

1. `packages/social-cards/` — pure-TS, framework-free OG/share-card generator using
   `satori` + `@resvg/resvg-js`, returning SVG + PNG for every card kind.
2. `prompts/social/` — surface × event-type post template library (TikTok / Instagram /
   X / YouTube Shorts), fully variable-driven.
3. `docs/27-social-distribution-strategy.md` — the playbook.
4. OG metadata wiring in `apps/marketing/` — Layout already exposes `ogImage`; we add a
   build-time card generator and per-page props.
5. `apps/api/src/routes/social-cards.ts` — comment-doc stub for the dynamic OG endpoint
   the API agent will mount later (added as a NEW file; we never touch `server.ts`).

## Constraints honoured

- Did not modify `packages/spec/`.
- Did not touch `apps/web/components/*`.
- Did not modify any `.astro` page bodies — only added `ogImage` props.
- Did not touch `apps/api/src/server.ts` — stub left as a new file under `apps/api/src/routes/`
  with a header comment instructing the API agent how to mount it.
- Branch is `feat/social-distribution-kit`, not pushed to main.
- Commits authored as `Tim Thomas <0800tim@gmail.com>` with DCO sign-off.

## Files added

- `packages/social-cards/` — pure-TS package, vitest-driven (75 tests).
- `prompts/social/*.md` — 18 markdown templates + variable-contract doc + README.
- `docs/27-social-distribution-strategy.md`
- `apps/marketing/scripts/build-og-cards.mjs` — pre-build generator that writes
  `apps/marketing/public/og/{slug}.png`.
- `apps/marketing/src/lib/og.ts` — small helper that enumerates pages → ogImage paths.
- `apps/api/src/routes/social-cards.ts` — comment-doc stub (no runtime registration).

## Open questions

- **Satori font loading**: not committed — the package's `fonts/README.md` documents
  how to fetch them. The unit tests don't need the binaries; only the marketing
  build-script and dynamic API route do. The build script logs a warning and exits
  cleanly if fonts are missing (CI-friendly).
- **Telegram preview**: Telegram reads `og:image` and `twitter:image`. All our cards
  exceed Telegram's minimum (200px); flagged for completeness only.
- **Sportsbook affiliate disclosure**: I shipped a default disclosure template per
  jurisdiction. Legal still has to sign off on the AU/UK/NZ wording.
- **Concurrent agents**: I noticed during build that the main checkout was switched
  to another agent's branch mid-session, wiping my untracked files. Recovered by
  using a dedicated worktree at `/home/clawdbot/clawdia/projects/vtorn-social/`.
  Recommendation: future agents should always work in a worktree, not the main
  checkout, when the repo has multiple concurrent builders.
