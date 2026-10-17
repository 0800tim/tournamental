# Unlanded branches: `feat/commentary` and `next15-dev`

> Read-only review, 2026-10-17, of the two branches the triage (`docs/reviews/2026-10-branch-triage.md`, PR #339) left for a decision. Nothing merged, closed or deleted. Evidence: the branches' commits and diffs against `main` at e1e0eac9, a `git merge-tree` dry run of each, and for the commentary package a throwaway worktree of main with the package dropped in to see what it takes to build and test today. That worktree is gone.

## 1. `feat/commentary`

### What it is

Four commits from 9 May 2026 on a base that is 863 commits behind `main`. Three are docs and chores (`docs/26-platform-strategy-and-syndicates.md`, six `tasks/inbox` files, a `.gitignore` line, a `wc2022-final-odds.json` that is already on main). The one that matters is `630d90ff feat(commentary): event-template commentary generator + TTS scheduler`, which adds `packages/commentary` (`@vtorn/commentary`, 10 files, about 560 lines):

- `src/templates.ts`: `generateCommentary(event, ctx)`, a pure, deterministic function from a spec `EventMessage` plus a lookup context (players, teams, score, minute, an "enthusiastic" flag) to one or more `CommentaryLine`s. It covers eleven football event types: kickoff, period start and end, shot, save, goal, score change, foul, substitution, penalty shootout start, attempt and end. Lines carry a channel (play-by-play, colour, structural) and a priority.
- `src/scheduler.ts`: `CommentaryScheduler`, a tiny frame-driven queue with a per-channel cooldown (600 ms default) and a backlog drop (2.5 s) so the voice does not talk over itself during scrambles. The renderer calls `tick(t_ms)` once per frame and plays what comes back.
- No audio. The README is explicit that synthesis (browser SpeechSynthesis or ElevenLabs through the API) and caching belong to the renderer and the API.
- Tests: 11 vitest cases (6 templates, 5 scheduler) covering each event type, determinism and cooldowns.

### Does main already have this?

Partly, and the missing part is exactly this package. Since May, main gained the renderer's audio pipeline from fidelity phase 3 (`docs/27c`) and the overlay design (`docs/31`): `apps/web/lib/audio/elevenlabs-stream.ts` opens the realtime ElevenLabs WebSocket and exposes `sendText(text)`, `pre-rendered-track.ts` plays MP3 lines from a manifest, `api/commentary/manifest` serves that manifest (a stub returning no lines; the batch render pipeline does not exist yet), `api/commentary/sign` mints the signed URL, and `lib/director/director-policy.ts` fires commentary cues around replays. What nothing on main does is turn a match event into a sentence. The spec has since grown an `event.commentary` message (`text`, `speaker`, `voice_id`) that only the mock producer emits, so a producer can hand text down, but there is no generator for real matches. `generateCommentary` is that generator and the scheduler is the piece between the director's cues and `sendText`.

### Does it fit the RWC 2027 plans?

Not the hub, pools and predictions plan: nothing in `docs/internal/rwc2027/` or the growth brief asks for commentary (the one hit there is a lead list of commentators). It fits the renderer roadmap (`docs/04`, `docs/10`, `docs/31`), which is the watch-along product, not the 2027 launch. Two things count against lifting it as is for rugby:

- The templates and the spec are football-shaped. The spec's event vocabulary is `kickoff, period_start, period_end, shot, save, goal, score_change, foul, substitution, penalty_*`, plus `pass`, `tackle`, `out_of_bounds`, `match_end` and `commentary`. Rugby needs try, conversion, penalty goal, drop goal, scrum, lineout, sin bin. That is spec work (orchestrator-only) before any template work.
- The copy is en-NZ English only; `docs/31` promises ten languages via pre-rendered MP3s. The package's determinism makes it a good base for that batch pipeline, but localisation is unbuilt.

### Effort and conflicts to land it on today's main

Measured in the throwaway worktree:

| Step | Finding |
| --- | --- |
| Merge the branch as is | Conflicts in `.gitignore` and `pnpm-lock.yaml` (pnpm 11 lockfile). The three docs and task commits also bring back `docs/26` and six `tasks/inbox` files that main no longer has, so do not merge the branch; cherry-pick or re-add the package only. |
| Workspace | `pnpm-workspace.yaml` already globs `packages/*`; nothing to register. |
| Spec package name | Every import says `@vtorn/spec`; main renamed it `@tournamental/spec`. A one-line sed across `src` and `tests`. |
| Test runner | The package pins `vitest ^2`; the workspace is on vitest 4. With the devDependency bumped and the spec aliased to source, all 11 tests pass on main (run with the workspace's vitest 4). |
| Typecheck | One error, in a test fixture: the spec's `event.pass` now requires `from`, the fixture builds `{ player, team, target }`. Five-minute fix. The source compiles. |
| Wiring | Nothing imports it. A consumer in `apps/web` would sit between the director's commentary cue and `elevenlabs-stream.sendText`, or feed the pre-render batch. That is new work, not a port. |

Call: half a day to land the package cleanly as a fresh branch from main (package only, renamed import, vitest 4, fixed fixture, README's `@vtorn` references updated), plus whatever the renderer integration is scoped at. Only worth doing when the watch-along renderer is back on the roadmap; until then the branch is a reference and the package can be lifted at any time because it is self-contained. Suggested: keep the branch, note the lift steps above in `IDEAS.md`, revisit after RWC 2027 launch.

## 2. `next15-dev`

### What it is

Tim's Next 15 and React 19 upgrade branch, last synced with main on 5 June 2026 (PR #287). Ten commits ahead of its base, 258 commits behind `main`. Nine of the ten are merges of main or fixes that main also has by the same subject (`fix(profile,super-admin)`, `feat(syndicate,admin): super-admin session bypass`, `fix(web): suppress <body> hydration warning`, `fix(leaderboard,admin): live days-to-kickoff`, `i18n(handle-gate): backfill`). Exactly one commit is unique: `9472d947 chore(deps,dev): bump web+admin to Next 15.5.19 / React 19.2.7 (dev only)`.

### What remains beyond main

Main runs Next 14.2.35 and React 18.3.1 in both `apps/web` and `apps/admin`, after the 4 June rollback the `next.config.mjs` comment describes. The unique commit's whole content is version bumps in two manifests plus the lockfile:

| Package | main | `next15-dev` |
| --- | --- | --- |
| next (web, admin) | ^14.2.35 | ^15.5.19 |
| react, react-dom | ^18.3.1 | ^19.2.7 |
| @types/react, @types/react-dom | ^18.3 | ^19.2 |
| eslint-config-next | ^14.2.35 | ^15.5.19 |
| @react-three/fiber | ^8.17.10 | ^9.6.1 |
| @react-three/drei | ^9.114.3 | ^10.7.7 |
| @react-three/postprocessing | 2.19.1 | ^3.0.4 |
| @react-three/rapier | 1.5.0 | ^2.2.0 |

No source changes: the code on main already carries the Next 15 accommodations (`serverExternalPackages`, `outputFileTracingRoot`, `experimental.externalDir`, `typescript.ignoreBuildErrors` with the comment that the source was written against React 19 types). A dry merge of the branch conflicts only on `pnpm-lock.yaml`, and that lockfile predates pnpm 11 anyway.

So what remains is the upgrade itself, not anything on the branch: the two manifests can be reproduced from the table above in a minute, and the four React Three Fiber majors (fiber 9, drei 10, postprocessing 3, rapier 2) are the real migration, since they change APIs the renderer uses. The branch is a record of which versions were tried together on 4 June; it is not a base to build on.

Call: close the PR if one is open and delete the branch once the table above is copied into the Next 15 plan; nothing else on it is unique. When the upgrade is reattempted, start from main in an isolated worktree, bump `next`, `react` and the types first with R3F held at 8 and 9 (fiber 8 declares React 18 peers, so that step may already force fiber 9), then take the R3F majors one at a time with the renderer tests.

## 3. Worth knowing, found on the way

The workspace typecheck that fails CI on `main` (every run since June) is two errors in `packages/bot-sdk/examples/02-claude-bot.ts` and `03-gpt-bot.ts`, not the Next or React types. A small fix would turn the Node job green and make the Dependabot and other PR checks meaningful again (see `docs/reviews/2026-10-dependabot-verification.md`).
