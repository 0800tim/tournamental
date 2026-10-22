# 2026-05-09 — orchestrator — phase-0

**Status**: done

**PRs**:
- #1 — `chore: phase-0 bootstrap` (merged as `dee384a`)
- #2 — `chore: stub builder dirs` (merged as `b6ae8ec`)

## Goal

Bring up the VTourn repo from a manual file copy: create the GitHub repo, land the workspace skeleton, stub the four parallel-builder directories, and dispatch issues so the AR-FR-2022 critical path can begin.

## Reading

- `STARTER-PROMPT.md` — the orchestrator briefing for this session.
- `REVIEW.md` — design-pack readiness audit (TL;DR: ready to build, spec at v0.1.1).
- `CLAUDE.md` — orchestrator + agent ops protocol; "Repo bootstrap" section is the exact Phase 0 script.
- `AGENT-PROMPTS.md` § 0–4 — orchestrator role and the four builder prompts.
- `CONTRIBUTING.md` — reviewer checklist used to self-review #1 and #2.

## Plan

1. Verify the file copy (37 files; clean `.DS_Store`).
2. `git init` + private repo on `0800tim/vtorn` + push initial import commit.
3. Phase 0 bootstrap PR: pnpm-workspace, top-level package.json, tsconfig.base.json, `@vtorn/spec` package, Apache 2.0 + CC-BY-4.0 licence files.
4. Stub-builder-dirs PR: minimal manifests + READMEs for `apps/statsbomb-replay/`, `apps/web/`, `apps/mock-producer/`, `packages/avatar/`.
5. Open four GitHub issues — one per builder — with the prompt body + link to AGENT-PROMPTS.md.
6. Write this session note. Commit to main.
7. Report back to Tim with repo URL, PRs, issue numbers, and the dispatch instruction.

## Decisions

- **Author identity for VTourn commits**: `Tim Thomas <0800tim@gmail.com>`. *Why*: clawdia's CLAUDE.md durable rule is "always use 0800tim@gmail.com". The STARTER-PROMPT's noreply suggestion was accompanied by "Tim can override later" — gmail is the override. Confirmed with Tim live.
- **`projects/vtorn/` ignored from clawdia's git tree**. *Why*: vtorn lives inside the clawdia working tree on this dev box. Adding to clawdia's `.gitignore` keeps the parent clean rather than leaving vtorn as a perpetually-untracked dir.
- **`--if-present` added to top-level workspace scripts**. *Why*: CLAUDE.md's bootstrap snippet uses `pnpm -r run typecheck` directly, but pnpm 10.x errors when no package implements the script. `--if-present` makes the workspace tolerant of partially-implemented scripts so each builder can opt in independently. Noted in PR #1 body.
- **Builder issues use `Closes #N` semantics**. *Why*: each builder's PR will be linked back to its issue, giving the orchestrator a clean Kanban view of "open builder issue + open PR" → "closed both on merge".

## Open questions

None blocking. Possible Phase 2 considerations to raise once builders land:

- Should we stand up GitHub Actions CI before or after the first builder PR? CONTRIBUTING.md describes the pipeline as if it exists; it doesn't yet.
- Reviewer agent (AGENT-PROMPTS § 5) — does Tim want it dispatched alongside the four builders, or only after the first PR opens?

## Outcome

What landed on `main` this session:

- `e7fbe03` — initial import (37 files)
- `dee384a` — Phase 0 bootstrap (#1): pnpm workspace, `@vtorn/spec@0.1.1`, LICENSE (Apache 2.0), `docs/LICENSE-DOCS` (CC-BY-4.0), tsconfig.base.json
- `b6ae8ec` — builder-dir stubs (#2): manifests + READMEs for the four parallel directories

Builder issues opened:

- #3 — Builder: `apps/statsbomb-replay/` — AR-FR 2022 producer (AGENT-PROMPTS § 1, doc 11)
- #4 — Builder: `apps/web/` — Next.js + R3F renderer (AGENT-PROMPTS § 2, doc 04)
- #5 — Builder: `packages/avatar/` + assets — procedural avatar pipeline (AGENT-PROMPTS § 3, doc 07)
- #6 — Builder: `apps/mock-producer/` — synthetic match generator (AGENT-PROMPTS § 4, doc 05)

Tests: no test suites exist yet; `pnpm typecheck` no-ops cleanly across all 5 workspace projects.

## Integration milestone (target end-state)

Once issues #3–#6 ship, the AR-FR demo runs end-to-end per CLAUDE.md "How to run the AR-FR demo":

```bash
# Terminal 1 — StatsBomb-replay producer
cd apps/statsbomb-replay
uv run python replay.py \
  --match=fifa-wc-2022-final-arg-fra-2022-12-18 \
  --time-scale=10 \
  --out=ws --port=4001

# Terminal 2 — renderer
cd apps/web
pnpm dev
# open http://localhost:3000/match/fifa-wc-2022-final-arg-fra-2022-12-18
```

Acceptance: HUD score ends 3-3 (regulation+ET) and 4-2 (penalty shoot-out); player nameplates float over the right body; commentary cues fire on goals; total runtime ≤ 15 min at `time-scale=10`. 30-second screen capture is shareable proof.

## Refs

- docs/02-spec.md (`SPEC_VERSION = "0.1.1"`)
- docs/04-renderer.md, docs/05-mock-producer.md, docs/07-avatars-and-assets.md, docs/11-historic-data-sources.md
- CLAUDE.md "Repo bootstrap" + "How to run the AR-FR demo"
- AGENT-PROMPTS.md § 0–4
- IDEAS.md additions: none this session
- Related sessions: this is the project's first session note
