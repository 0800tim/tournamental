---
agent: A11
task: Phase 2 polish for the browser bot arena
status: complete
refs:
  - docs/superpowers/specs/2026-06-07-bot-arena-design.md
  - apps/web/components/browser-swarm/*
  - apps/web/app/run/bots/*
---

# Outcome summary

All three deliverables landed:

1. **`apps/web/components/browser-swarm/cascade.ts`**: per-bot cascade
   resolver that converts each bot's 72 group-stage Outcome picks into
   group standings (via bracket-engine `computeGroupStandings()`),
   picks 8 best-thirds by FIFA rank, then walks knockouts with
   incremental `cascade()` calls so r16 onwards know who won the
   upstream tie. The `/run/bots/[index]` page now shows real team
   names ("France vs Argentina") instead of slot labels
   ("winner_grpA vs annex_third_vs_grpB") in every knockout row.

2. **`apps/web/components/browser-swarm/uniqueness.ts`**: index-based
   perturbation. Bot 0 = pure chalk; bots 1..S = single-deviation
   brackets ranked by ascending chalk confidence; bots S+1.. = double-
   deviation, then triple, in lexicographic order. Unranks in
   O(level x S) per bot. The worker now uses this for the committed
   outcome so two distinct indices in the same operator scope are
   GUARANTEED structurally distinct.

3. **`apps/web/components/browser-swarm/anchor.ts`**: user-anchored
   swarm slider. New `select` UI in BrowserSwarm.tsx (Off / Soft /
   Strong / Lockstep). The slider snapshots the user's bracket from
   localStorage on every Start press, plus persists the weight +
   bracket-hash into `swarm_state` so committed batches stay locked
   to the snapshot they used.

# Tests

- `apps/web/__tests__/browser-swarm-cascade.test.ts` (6 tests).
- `apps/web/__tests__/browser-swarm-uniqueness.test.ts` (6 tests).
- `apps/web/__tests__/browser-swarm-anchor.test.ts` (7 tests).

All 19 pass.

# Type safety

`pnpm typecheck` clean on every touched file. Pre-existing typecheck
errors elsewhere in the repo (avatar, social-cards, spec-client) are
not in my scope and are due to missing devDependency installs on
this worktree.

# Plan

Three deliverables on top of the Phase 1 browser swarm:

1. **Per-bot bracket cascade resolution** (`cascade.ts`)
   - Build group standings from the bot's matches 1-72 picks.
   - Pick best-thirds deterministically from the bot's chalk weights.
   - Call `@tournamental/bracket-engine`'s `cascade()` so the 32 knockouts
     resolve to real team codes.
   - Wire the `/run/bots/[index]` detail page to display real team names
     in every knockout row.

2. **Within-swarm uniqueness guarantee** (`uniqueness.ts`)
   - Rank matches by chalk-confidence (lowest confidence first).
   - Bot 0 = pure chalk (favourite for every match).
   - Bot k in [1, M] = single deviation on the (k-1)-th lowest-confidence
     match.
   - Bot k in (M, M + C(M,2)] = double-deviation across pairs, etc.
   - Expose this as the swarm's pick generator so two distinct indices
     always produce structurally distinct brackets.

3. **User-anchored swarm slider** (`anchor.ts`)
   - Read the user's local bracket draft from localStorage
     (`vtorn:bracket:v2:fifa-wc-2026:<user_local_id>`).
   - Blend `chalk_pick` with `user_pick` by anchor weight (0 / 0.4 / 0.75 / 1).
   - Persist the anchor weight to IndexedDB `swarm_state.anchor_weight`.
   - Render the slider on `/run` (Off / Soft / Strong / Lockstep).
   - Snapshot the bracket hash into the swarm completion payload so
     post-commit batches stay locked to that snapshot.

## Tests

- Unit tests for `cascade.ts` (real WC fixtures, sample bot index).
- Unit tests for `uniqueness.ts` (bot 0 vs bot 1 vs bot N: structurally
  distinct brackets, deterministic, count of single-deviation brackets
  matches matches.length).

## Conventions

- Conventional Commits, signed (-s), `Tim Thomas <0800tim@gmail.com>`.
- NZ English. NO em-dashes (grep before each commit).
- TDD where it makes sense.
