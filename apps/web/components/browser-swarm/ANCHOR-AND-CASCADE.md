# Anchor and cascade: how your bots back your bracket

This explains, in plain language, how the browser bot-swarm makes the
bots you generate **bias toward your own bracket**, how it keeps that
bias fresh as the tournament unfolds, and how knockout bots start picking
the teams that actually advanced once results land.

It is written for anyone, not just engineers. If you just want the short
version: your bots favour your champion, they re-check themselves
whenever you open or return to the page, and there is a manual
"Re-run my swarm" button if you ever want to force it.

## 1. Bots bias toward your bracket (the anchor)

When you generate a swarm, every bot makes a pick for all 104 World Cup
2026 matches. By default each bot starts from the bookmaker-style "chalk"
odds plus a small sentimental lean, which on its own would scatter the
bots' champions across many teams.

The **anchor** changes that. The "Anchor to my bracket" control on `/run`
blends each bot's pick with **your** saved bracket:

| Setting   | What it means                                            |
| --------- | -------------------------------------------------------- |
| Off       | Pure chalk. Your bracket is ignored.                     |
| Soft      | 40% your pick, 60% chalk.                                |
| Strong    | 75% your pick, 25% chalk. **This is the default now.**   |
| Lockstep  | 100% your pick wherever you have one.                    |

"Strong" is the default because the whole point of the swarm is to back
*your* read of the tournament. With Strong selected and Portugal as your
champion, a clear majority of your bots crown Portugal, with a minority
"tail" still backing other outcomes so upsets stay covered. It is a
strong centre of mass on your bracket, not 10,000 identical copies.

### Group games vs knockout games

The blend is applied slightly differently in the two stages, on purpose:

- **Group matches** are blended independently. Even at Strong, your
  bots show a realistic spread of group-stage results, because real
  tournaments have upsets and a swarm that agreed on every group game
  would look fake.
- **Knockout matches** are blended at the **path level**: a given bot
  either follows your bracket through the whole knockout tree or runs
  its own chalk path. This is what makes "Strong = 75%" actually move
  the champion. If each knockout round re-rolled independently, the
  chance of a bot reaching *your* champion would shrink with every round
  and the champion column would barely budge. Correlating a bot's
  knockout run fixes that: roughly the anchor weight (so ~75% at Strong)
  of your bots crown your champion, and the rest form the diversified
  tail.

### It is deterministic

Same inputs always produce the same bots, bit for bit. Given the same
master seed, the same bracket snapshot, and the same anchor weight, bot
#523,891 always makes exactly the same 104 picks. This is what lets the
swarm regenerate any bot on demand (so we never have to store a billion
brackets) and underpins the audit / receipt story. Nothing here is
random in the "different every time" sense; it is seeded.

## 2. Where your bracket comes from (local first, server fallback)

The anchor needs to know your bracket. It looks in two places, in order:

1. **Your browser's saved draft** for this tournament (instant, offline).
2. If that is empty, **your bracket on the server** via `GET
   /v1/bracket/me`. This is the fix for the old "Last anchor hash:
   00000000:00000000" bug: if you built your bracket on a different
   device or origin, your saved picks live on the game-service, and the
   swarm now reads them from there instead of anchoring to nothing.

The bracket is read once and cached for the run, so the swarm does not
re-hit the network on every render. The "Last anchor hash" line on the
anchor card shows a short fingerprint of the bracket the swarm is
anchored to, so once you have a real bracket it stops showing zeros.

## 3. Re-forecasting (keeping the swarm current)

Odds move and brackets resolve over a tournament, so the swarm
re-forecasts, meaning it re-derives its forward-looking picks from the
latest odds and the latest state of your bracket. This happens:

- **Automatically when you open `/run`.**
- **Automatically when you return to the tab** (switch back to it).
- **Automatically when a knockout stage resolves** while the page is
  open (see the cascade section below).
- **Manually** via the **"Re-run my swarm"** button on the anchor card.

A **"last re-forecast: &lt;time&gt;"** line next to that button tells you
how fresh the current forecast is. You never *have* to press the button;
it is there for when you want to force a refresh after editing your
bracket. Automatic re-forecasts are debounced so rapid tab-switching
does not spam the network.

## 4. The knockout cascade (real teams as results land)

Before the tournament starts, nobody knows who wins Group A, so knockout
slots are placeholders ("winner of Group A", "best third", and so on).
Each bot fills those placeholders from **its own** predicted group
standings, then picks knockout winners along that path, biased toward
your bracket wherever your teams are still alive.

Once the group stage is actually played, we know the **real** teams that
advanced. From that point the cascade projects those real advancing teams
into the knockout slots, so your knockout bots are choosing between teams
that genuinely qualified, not slot labels. Your bracket bias still
applies on top: where the teams you predicted are still in the running,
the bots keep favouring your path.

This is built to switch on by itself as results arrive. Before any
results exist, it gracefully does nothing and the bots use their own
predicted standings, exactly as before. The hand-off point is the resolved
group standings the game-service publishes once matches settle.

## Where this lives in the code

- `anchor.ts` - the bracket snapshot (local + server fallback), the
  blend (`blendOutcome`), and the deterministic per-match / per-path
  draws (`anchorDrawForMatch`).
- `regenerate.ts` - the on-demand pick engine. `regenerateBotPick`,
  `regenerateBotBracket`, and `regenerateBotBracketUnique` all take the
  anchor snapshot and apply it; this is the source of truth the
  `/run/bots` list and detail pages render from.
- `cascade.ts` - per-bot knockout resolution, real-team projection
  (`ResolvedGroupStandings`), and `championForBot` (used by the list to
  show each bot's actual champion).
- `worker.ts` - the generation path; applies the same anchor blend so
  committed bots match the regenerated display bit for bit.
- `BrowserSwarm.tsx` - the `/run` UI: the anchor dropdown (default
  Strong), the re-forecast triggers, the "Re-run my swarm" button, and
  the "last re-forecast" line.
