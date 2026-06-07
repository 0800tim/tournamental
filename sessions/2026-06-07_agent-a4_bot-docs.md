# A4, Bot Arena documentation pack

status: complete (pending A1/A2/A3 ground-truth confirmations)
agent: A4
branch: agent/A4-bot-docs

## Task

Write the Open Bot Arena documentation pack: doc 30 (browser-swarm architecture), doc 31 (merkle + OTS), doc 32 (perfect-bracket experiment), plus internal audit-export-format + press draft. Update doc 17 to clarify what's wired today vs the long-term VStamp spec. Add a Bot Arena section to the README.

## Files written

- `docs/30-browser-swarm-architecture.md`, ~2,600 words. New.
- `docs/31-merkle-and-ots-proofs.md`, ~3,000 words. New.
- `docs/32-perfect-bracket-experiment.md`, ~1,750 words. New.
- `docs/internal/audit-export-format.md`, ~1,500 words. New. Gitignored per project policy.
- `docs/internal/perfect-bracket-press-draft.md`, ~870 words. New. Gitignored per project policy.
- `docs/17-vstamp-and-prediction-iq.md`, updated. Added a "What's actually wired today" section at the top distinguishing the per-kickoff path (shipped in `apps/game/src/services/kickoff-commit.ts`) from the per-prediction-batch path (still queued).
- `README.md`, updated. New "Bot Arena" section between "What just shipped" and "Build on Tournamental in 20 minutes".

## Ground-truth questions for A1/A2/A3

Three `TODO[ground-truth]` markers placed in the docs that need confirmation before publication:

1. **Canonical-form vs compact-form merkle leaves at federation publish.** The browser-swarm worker today computes per-worker merkle roots over compact 8-char strings (`base36(bot_index, 6) + outcome_code`). The canonical form per spec §15.6 is `sha256(bot_id|match_id|outcome|locked_at_utc)`. Where in the pipeline does the conversion happen? If the published root is the compact-form root, then doc 31 needs to document the compact-form rules too. A1's federation publish wire-up should answer this.

2. **Odd-node promote vs duplicate divergence.** `apps/game/src/lib/merkle.ts` (Node side) does `cur.push(cur[cur.length - 1]!)`, the duplicate form. `apps/web/components/browser-swarm/merkle.ts` (browser side) says "Odd nodes promote without rehashing", the promote form. Both produce the same root for the same leaf set if pursued consistently. We need to pick one and align both implementations; if not aligned, a browser-built root won't verify against a Node-built root.

3. **Standalone CLI verifier.** Doc 31, doc 32, and the audit-export bundle doc all reference `packages/bot-node/src/verifier/` as the open-source reference verifier. Does A3's docker image ship this? If not, the audit flow described in doc 32 has no public verifier and the press draft needs softening on the "anyone can audit" claim.

## Other open items

- Phase 2 per-user master seeds. Today `MASTER_SEED = "tournamental-browser-v1"` is a global constant. Doc 30 flags this as Phase 2 work.
- Cross-tab aggregation modes 2 and 3 (operator-grouped, client-side merged) need the central `operator_email` grouping endpoint. Doc 30 flags this.
- Federation retry queue is logged-only today. Doc 30 flags this.
- The press draft has a `[PLACEHOLDER]` for Tim's quote. Per editor's notes at the bottom of the draft.

## Coordination

A1, A2, A3 are writing code in parallel. The docs describe the intended architecture; if their actual implementation diverges, that's a follow-up via the TODO markers above.

## Next steps

- A1/A2/A3 to resolve the three ground-truth questions before press.
- Tim to drop in his press-draft quote.
- The internal docs (`docs/internal/audit-export-format.md`, `docs/internal/perfect-bracket-press-draft.md`) need to sync to growthspurt Drive parentId `1bQg04rzrYXtx3QMocASP1dVnmSqtK1rH` per `feedback_business_assets_in_drive` memo.
