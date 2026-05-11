# 05, Mock Producer

> A pure-synthetic spec stream. No external inputs. Used as the canonical test fixture for renderer development, and as the demo stream when no live game is active.

## Why

Renderer agents need a stable, reproducible target. A hand-coded mock match with deterministic seeded RNG gives every dev the same input, removes the dependency on a live game during development, and works offline forever.

It's also genuinely useful as a public "always-on" demo: the framework site at `/match/demo` runs the mock producer in a loop so visitors can always see *something*.

## Stack

- Node 20+, TypeScript, single binary (`apps/mock-producer/`).
- No DB, no network deps beyond the WebSocket / HTTP it serves.
- One process, one match at a time. To run multiple, run multiple.

## Output modes

Configurable via CLI flags, all emit identical stream content:

- `--out=ws --port=4001`, WebSocket server, broadcast to any connected client.
- `--out=sse --port=4001`, SSE endpoint at `/stream`.
- `--out=file --path=./out`, write `init.json` + `chunk-NNNNNN.ndjson.gz` + `live.m3u8` exactly as the production stream server does. Lets a renderer test the CDN path without standing up the real origin.
- `--out=stdout`, NDJSON to stdout for piping into anything.

## Match generation model

Don't try to simulate real football. Aim for *plausible motion that triggers all the renderer code paths*. The goals are coverage and watchability, not tactical realism.

State machine:

```
       ┌─────────────────────────┐
       ▼                         │
   ┌────────┐ pass ────────► ┌─────────┐
   │POSSESS │                │ POSSESS │
   │ team A │ ◄──── pass ─── │ team B  │
   └───┬────┘                └────┬────┘
       │                          │
       │ shot                     │ shot
       ▼                          ▼
   ┌────────┐                ┌─────────┐
   │ SHOT   │ goal/save ───▶ │ KICKOFF │
   │  → out │ → restart      │         │
   └────────┘                └─────────┘
```

A "tick" runs every 100ms. Each tick:

1. The carrier (a player on the possessing team) moves 0.4–0.7m toward a target.
2. With probability `p_pass` (~0.05 per tick = avg 2s holding), pick a teammate at random within passing range, emit `event.pass`, and start a ball flight to that teammate over 0.4–1.0s.
3. With probability `p_shot_when_in_final_third` (~0.02 per tick), emit `event.shot` toward the opposing goal. Resolve via random keeper save vs. goal (~30% goal probability).
4. Other players: drift toward their formation positions with damped noise. Track the ball loosely, defenders converge on the carrier; attackers space out.
5. Emit a `state` message at 10Hz (every other tick).

After a goal: `event.goal`, `event.score_change`, `event.commentary`, then 5s pause (celebration animations on the renderer side), then `event.kickoff` for the conceding team.

After a shot saved or missed: `event.save` or `event.out_of_bounds`, restart 2s later.

Half-time at `t = 45min * 60s * 1000 = 2_700_000ms` (or scaled if `--match-duration-ms` overrides). Full-time at `5_400_000ms`.

## Determinism

Seeded RNG (e.g. `seedrandom`). CLI flag `--seed=42` reproduces an exact match. The default seed produces a match that, by minute 90, has 2–4 goals and visible action in every minute (no long quiet spells). Tune the seed offline, then commit it.

## Time scaling

`--time-scale=10` runs a 90-min match in 9 real-time minutes. Useful for renderer dev so you don't wait forever to see the second half. `state.t` should still reflect *match time*, not real time, so the renderer's clock display is correct; it's only the wall-clock pacing that changes.

## Commentary

Each significant event (goal, shot on target, yellow card, half-time, full-time) emits an `event.commentary` with a hand-templated string and a `voice_id`. Templates live in `apps/mock-producer/templates/commentary.json`:

```json
{
  "goal_home": [
    "GOAL! {scorer} buries it for {team}!",
    "And it's there! {scorer} with a finish, {team} lead!",
    "{team} score! {scorer} makes it {home}-{away}!"
  ],
  "shot_saved": ["{keeper} gets a hand to it.", "Brilliant save by {keeper}!"]
}
```

Renderer feeds these to a TTS pipeline if one is configured; otherwise they show in the HUD ticker only.

## CLI

```
mock-producer \
  --seed 42 \
  --match-duration-ms 5400000 \
  --time-scale 1 \
  --out ws --port 4001 \
  --teams ./teams/blue-vs-red.json   # optional, otherwise generates demo teams
```

## Acceptance criteria

- [ ] Same `--seed` produces byte-identical message sequences.
- [ ] Output passes spec validation (write a small validator that loads `spec/types.ts` and checks every emitted message).
- [ ] All standard event types appear at least once in a default 90-min match: `kickoff`, `pass`, `shot`, `goal`, `save`, `tackle`, `foul`, `out_of_bounds`, `substitution`, `period_start`, `period_end`, `match_end`.
- [ ] Renderer connecting to `--out ws` shows continuous, plausible motion with no teleports and the score eventually changes.
- [ ] `--out file` produces a directory the reference renderer can load via the CDN path.

## What's out of scope

- Tactics (no formation switching, no marking, no offside).
- Realistic ball physics (parabolic with gravity is enough; collisions ignored).
- Player attributes (every player has identical stats).
- Multi-match orchestration (one process, one match).

A more sophisticated *simulation* lives in `apps/sim-producer/` later, this one is purely about emitting a plausible stream for renderer development.
