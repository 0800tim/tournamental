# STARTER-PROMPT.md — first prompt for the dev-server agent

> Tim copies the docs pack to a folder on the dev server, then opens Claude inside that folder and pastes the prompt below. The agent creates the GitHub repo `0800tim/vtorn` (private), pushes the initial commit, runs Phase 0 setup, and dispatches the four parallel builders for the AR-FR 2022 demo.

## Files to copy across (manual rsync / drag-drop)

Copy **everything in this folder except**:

- `.DS_Store` (macOS metadata)
- `.git/` (will be created fresh on the server)
- `docs/VTourn PITCH.md` (duplicate of root `VTourn Pitch.md` — skip)
- `docs/VTron Monitization.md` (legacy ChatGPT brainstorm — content already folded into doc 18 — skip)

What you should see on the server after copy:

```
<server-root>/
├── README.md
├── VTourn Pitch.md
├── REVIEW.md
├── CLAUDE.md
├── AGENT-PROMPTS.md
├── CONTRIBUTING.md
├── IDEAS.md
├── STARTER-PROMPT.md          (this file)
├── docs/                       (01–21, no extras)
├── spec/                       (types.ts + examples/)
├── prompts/                    (frame-analyzer.md, commentary-extractor.md)
└── sessions/                   (README.md only)
```

37 files total. Verify with `find . -type f | wc -l` after copy.

## The prompt

Paste this into Claude (Claude Code, Cursor, Aider, etc.) in the server folder:

```
You are the VTourn project bootstrap orchestrator on Tim's dev server. The
files in this folder are a fresh manual copy of the design pack from his
Mac. There is no git history yet. `gh` CLI is already installed and
authenticated as Tim's GitHub user (0800tim).

YOUR JOB, IN ORDER

1. Orient and verify the copy.
   - Run `ls -la` to confirm the file tree.
   - Confirm that .DS_Store, .git/, docs/VTourn PITCH.md, and
     docs/VTron Monitization.md are NOT present. If any are, delete them.
   - Confirm 37 working files: `find . -type f | wc -l`.
   - Read REVIEW.md fully. Read CLAUDE.md fully. Read AGENT-PROMPTS.md
     top to bottom. Skim README.md and "VTourn Pitch.md".
   - Confirm spec/types.ts begins with `export const SPEC_VERSION = "0.1.1"`
     and contains event.penalty_attempt etc. If not, STOP and tell Tim.

2. Initialize git and push to a new private GitHub repo.
   - `git init -b main`
   - `git config user.name "Tim Thomas"` (or whatever Tim's GitHub display
     name is — check `gh api user --jq .name` and use that).
   - `git config user.email "0800tim@users.noreply.github.com"` (the
     GitHub privacy-preserving noreply email; Tim can override later).
   - Write the canonical .gitignore from CLAUDE.md "Repo bootstrap"
     section.
   - `git add -A`
   - Commit with `git commit -s` and the following message body:

     chore: import VTourn design pack v0.1.1

     Initial commit of the complete design pack (37 files):
     top-level docs, docs/01–21, spec/, prompts/, sessions/.
     Spec is at v0.1.1 with penalty-shoot-out events for the AR-FR
     2022 World Cup Final demo.

     Refs: REVIEW.md

   - Create the remote and push in one shot:
       gh repo create 0800tim/vtorn --private --source=. --remote=origin \
         --description "VTourn — verified tournament prediction game + 3D match renderer (vtourn.com)" \
         --push
   - Confirm the push landed: `gh repo view 0800tim/vtorn --web` printed
     URL plus `git log --oneline origin/main`.

3. Phase 0 bootstrap (per CLAUDE.md "Repo bootstrap" section).
   - Branch off main: `git checkout -b setup/phase-0-bootstrap`.
   - Create:
     - pnpm-workspace.yaml
     - top-level package.json (name: "vtorn", private, with dev/build/lint/
       test/typecheck scripts per CLAUDE.md)
     - tsconfig.base.json (strict, ES2022, Bundler module resolution)
     - packages/spec/src/index.ts  (cp from spec/types.ts)
     - packages/spec/package.json  (name @vtorn/spec, version 0.1.1)
     - LICENSE  (Apache 2.0 canonical text from
       https://www.apache.org/licenses/LICENSE-2.0.txt)
     - docs/LICENSE-DOCS  (CC-BY-4.0 canonical text from
       https://creativecommons.org/licenses/by/4.0/legalcode.txt)
   - `pnpm install` — must succeed.
   - `pnpm typecheck` — must succeed (no apps/* yet, will be a no-op).
   - Stage, commit (`chore: phase-0 bootstrap`), push the branch.
   - Open the PR: `gh pr create --fill --base main --title "chore: phase-0 bootstrap"`.

4. Self-review the PR against the reviewer checklist in CONTRIBUTING.md.
   - Manually run lint + typecheck. Tests likely don't exist yet — fine.
   - Squash-merge with `gh pr merge --squash --delete-branch` once the
     checklist is clean.

5. Stub the four builder directories on main (separate commit on a new
   branch `chore/builder-stubs`).
   Each gets a minimal manifest plus a README.md saying which builder
   prompt owns it.
   - apps/statsbomb-replay/
       pyproject.toml stub for uv
       README.md: "Owned by AGENT-PROMPTS.md section 1. See docs/11."
   - apps/web/
       package.json stub with workspace dep on @vtorn/spec
       README.md: "Owned by AGENT-PROMPTS.md section 2. See docs/04."
   - apps/mock-producer/
       package.json stub with workspace dep on @vtorn/spec
       README.md: "Owned by AGENT-PROMPTS.md section 4. See docs/05."
   - packages/avatar/
       package.json stub
       README.md: "Owned by AGENT-PROMPTS.md section 3. See docs/07."
   Open and merge a `chore: stub builder dirs` PR.

6. Open four GitHub Issues, one per builder, titled exactly:
   - "Builder: apps/statsbomb-replay/ — AR-FR 2022 producer"
   - "Builder: apps/web/ — Next.js + R3F renderer"
   - "Builder: packages/avatar/ + assets — procedural avatar pipeline"
   - "Builder: apps/mock-producer/ — synthetic match generator"
   Each issue body is the corresponding builder prompt from
   AGENT-PROMPTS.md, plus a link to that file. Use:
       gh issue create --title "<title>" --body-file - < /tmp/<n>.md

7. Write the session note at
   sessions/<YYYY-MM-DD>_orchestrator_phase-0.md describing what you did,
   the four builder issue numbers, and the integration milestone (running
   AR-FR demo end-to-end per CLAUDE.md "How to run the AR-FR demo").
   Commit + push directly to main with `docs(sessions): orchestrator
   phase-0 note`.

8. Report back to Tim with:
   - Repo URL (https://github.com/0800tim/vtorn)
   - The merged PRs (Phase 0 bootstrap, builder stubs)
   - The four builder issue numbers
   - A short copy-pasteable summary: "Paste AGENT-PROMPTS.md section 1
     into a new Claude/Cursor session in the repo's root, repeat for
     sections 2–4. They will run in parallel against issues #N1–N4."
   - Status: "Phase 0 complete. Ready to dispatch builders."

CONSTRAINTS
- Do not modify the spec (spec/types.ts or docs/02-spec.md) without
  explicit approval from Tim.
- Do not write code inside the four builder directories yourself —
  that is their work.
- Do not make the GitHub repo public until Tim says so.
- Follow CLAUDE.md's session protocol: branch, session note,
  Conventional Commits with DCO sign-off (`-s`), open a PR for every
  non-trivial change.
- If `gh` auth fails for any reason, STOP and ask Tim to run
  `gh auth login` — do not paper over auth errors.
- If anything in the docs is ambiguous or contradictory, ask Tim. Do
  not guess and proceed.

When all of steps 1–8 are complete, your standing role per
AGENT-PROMPTS.md section 0 begins: watch the four builder PRs as they
land, coordinate cross-agent contract questions, triage IDEAS.md
weekly, merge after the reviewer agent approves.

Begin with step 1.
```

## After this prompt finishes

The agent stops at "Phase 0 complete. Ready to dispatch builders." Then:

1. Open four more Claude / Cursor / Aider sessions in the same repo root.
2. In each, paste the matching section from `AGENT-PROMPTS.md`:
   - Session A → section 1 (StatsBomb replay producer, Python)
   - Session B → section 2 (Next.js + R3F renderer)
   - Session C → section 3 (avatar pipeline + assets)
   - Session D → section 4 (mock producer)
3. They run in parallel. Each opens a feature branch, ships a PR.
4. The orchestrator session is recalled with `AGENT-PROMPTS.md` section 0 to coordinate, review, and merge.
5. Optionally a fifth session runs `AGENT-PROMPTS.md` section 5 (reviewer agent) continuously to catch quality issues on every PR.

Target end-state: the AR-FR 2022 World Cup Final replay running in your browser. The runbook for that integration test is in CLAUDE.md ("How to run the AR-FR demo").

## Why "manually copy + server creates repo" instead of "git push from Mac"

Because the cowork sandbox where these docs were authored can't authenticate to GitHub as 0800tim, and the dev server already has `gh` authenticated and fast network — so the cleanest hand-off is the manual copy across, then let the server-side agent do the git work in one continuous session. Avoids any token-juggling and gives the agent ownership of the entire bootstrap from minute zero.
