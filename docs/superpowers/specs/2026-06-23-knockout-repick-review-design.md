# Knockout re-pick / review flow (humans)

- Status: draft (awaiting review)
- Date: 2026-06-23
- Scope: human players only. Bot swarm scoring is unaffected.
- Related code: `apps/web/lib/bracket/cascade-bridge.ts`, `apps/web/lib/bracket/merge.ts`,
  `apps/web/lib/bracket/api.ts`, `apps/web/components/match-pick/useMatchPick.ts`,
  `apps/web/app/world-cup-2026/calendar/CalendarPicks*.tsx`, `apps/web/components/bracket/*`.

## Problem

Tournamental's bracket game is a prediction cascade: a player forecasts group
standings plus the best-8 third-placed nations, which auto-fills *their predicted*
knockout bracket, and they pick a winner at every knockout slot. Knockout fixtures
are stored as structural slots (`W89`, `L101`), not concrete teams, and a pick is
stored as an outcome (`home_win` / `away_win`) on the slot's match id.

When the group stage finishes, the **real** Round of 32 matchups are set, and they
almost always differ from what a given player predicted. The player's knockout
picks were made against the teams they expected to qualify, so once reality lands
those picks may no longer reflect the player's actual view. The same happens at
every later round (R16, QF, SF, final), because each round's real matchups are
only known once the previous round completes.

Today nothing prompts players to revisit these picks, and the bracket keeps showing
their predicted matchups rather than the real ones.

## Goals

- When a knockout round's real matchups become known, switch that round's displayed
  matchups from the player's predicted cascade to the real teams.
- Carry each player's existing per-slot winner choice forward onto the real teams as
  an editable default. No pick data is destroyed.
- Mark the round "needs review" and invite players back (email + WhatsApp + SMS)
  to confirm or change their picks.
- Apply the same flow to every knockout round (R32, R16, QF, SF, final).

## Non-goals

- Late-joiner group-stage scoring (the points missed by joining after the group
  stage began). Out of scope here; a separate design. Note the knockout half of the
  late-joiner problem is solved for free: real matchups remove the cascade
  dependency, so a late joiner can pick the knockouts directly.
- Any change to bot-swarm scoring.
- Any change to the per-match kickoff lock.

## Current behaviour (confirmed in code)

- Picks lock per match at that match's kickoff. The server rejects post-kickoff
  edits (SEC-BRK-02, enforced in `lib/bracket/api.ts` and `lib/bracket/merge.ts`).
  R32 picks therefore stay editable until each R32 game kicks off.
- A pick is stored as `{ match_id: { outcome } }` in the player's bracket; teams are
  derived, not stored on the pick.
- `cascade-bridge.ts` resolves slots (`W89`, best-thirds, etc.) into teams from the
  player's group predictions plus their `bestThirds` choices.

## Design

### Pick states (per knockout match, per player)

- `predicted`: pre-concretisation. Teams come from the player's own cascade.
  Unchanged from today.
- `needs-review`: the round's real matchups are set. The player's stored winner-side
  choice is carried onto the real teams as the default. Counts for scoring as-is.
- `confirmed`: the player has opened the match and confirmed or changed the pick.
  Clears the nudge only; scoring is identical to `needs-review`.
- `needs-pick`: no stored pick exists for this slot (for example a late joiner).
  Blank; the player must choose; does not auto-score.
- `locked`: the match has kicked off; frozen. Existing rule, unchanged.

### Trigger and the swap

When a knockout round's real matchups become determined, that round flips from
`predicted` to `needs-review` for every player:

- R32 determined when the group stage is fully resulted and the best-8 third-placed
  nations are finalised.
- R16 determined when R32 is fully resulted. QF when R16 is resulted, and so on.

Mechanically, `cascade-bridge.ts` gains a per-round "team source" toggle. For a
round whose real matchups are known, it resolves that round's slots from **real
results** instead of the player's predicted cascade. Because picks are stored on the
slot's match id, the stored outcome automatically re-applies to the real teams; no
pick row is rewritten. Rounds whose real matchups are not yet known stay `predicted`.

The review state is derived, not stored on the pick: a knockout match is
`needs-review` when its round is concretised and the player has not confirmed it
since concretisation. A per-player, per-match `reviewed_at` marker records each
confirmation; a match clears when `reviewed_at >= round_concretised_at`. "Review
all" writes a confirmation for every still-defaulted match in the round at once.

### Scoring

A `needs-review` pick scores exactly as it stands, whether or not the player returns.
Inaction never costs points. Confirming or changing a pick only updates the stored
outcome and clears the review badge. `needs-pick` (no stored outcome) does not
auto-score.

### Notifications

When a round concretises, fan out one prompt per player who has picks in the pool,
over **email + WhatsApp + SMS** (WhatsApp and SMS via the Aiva gateway). Copy:
"Your Round of 32 is set. Review your 16 picks." The message deep-links to the
in-app review flow. The fan-out is a new job triggered by the "round complete"
event; it is idempotent per (player, round) so a re-fire does not double-send.

### In-app review UX

- A persistent review banner at the top of the bracket / calendar while the player
  has any `needs-review` matches in a live round: "Your Round of 32 is set. Review
  your N picks."
- Per-match "needs review" badges on each affected knockout card.
- Two ways to clear: confirm each match individually, or a round-level
  "Review all" that confirms every still-defaulted pick in the round in one tap.
  Changing a pick also confirms it.

### Edge cases

- Late joiner / no stored pick: `needs-pick`, blank, same review flow, nothing to
  carry, not auto-scored.
- Player never returns: carried picks stand and score.
- Real matchup equals the player's predicted one: still flagged `needs-review` for
  consistency. Cheap and honest.
- Pick already locked (match kicked off before review): stays `locked`, cannot be
  changed, scores as it stood at kickoff. Banner counts only still-editable matches.

## Architecture

- `lib/bracket/cascade-bridge.ts`: add a per-round team-source resolution (real vs
  predicted) keyed on which rounds are concretised, plus derivation of the per-match
  review state from concretisation status and the player's per-match `reviewed_at`
  markers.
- "Round complete" detection: derive from recorded match results (all matches of the
  prior phase resulted, and for R32 the best-thirds finalised). Surface as an event
  the notification job subscribes to.
- Notification fan-out: a new job that, on round-complete, enumerates pool members
  with picks and sends email + WhatsApp + SMS via the Aiva gateway, idempotent per
  (player, round).
- Pick storage and merge (`lib/bracket/merge.ts`, `useMatchPick.ts`): unchanged for
  storage; the review marker is additive.
- UI: review banner and per-match badges in the bracket and calendar pick
  components; a "Review all" action that writes confirmations for the round.

## Testing

- Cascade source switch: a round with known real results resolves real teams; an
  unconcretised round resolves predicted teams.
- Carry-forward: a stored R32 outcome re-applies to the real teams without rewrite,
  and scores against the real result.
- Review state: `needs-review` after concretisation, `confirmed` after confirm or
  change, `needs-pick` when no stored outcome, `locked` after kickoff.
- Scoring: unreviewed carried pick scores identically to a confirmed one.
- Notification idempotency: a re-fired round-complete event does not double-send.
- Recurrence: the flow repeats correctly for R16, QF, SF, final.

## Future work

- Late-joiner group-stage scoring (separate design).
