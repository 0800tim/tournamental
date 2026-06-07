# 32, The Perfect Bracket Experiment

> Can anyone in the world generate a perfect 104-match FIFA WC 2026 bracket using an AI swarm? This is the user-facing story behind the Open Bot Arena: a public, open-source, blockchain-anchored experiment that anyone can join in 30 seconds from a browser tab.

This doc is the **narrative**. The maths is real; the architecture under it is in [doc 30, Browser Swarm Architecture](30-browser-swarm-architecture.md); the cryptography is in [doc 31, Merkle and OTS Proofs](31-merkle-and-ots-proofs.md). For the press launch draft, see [docs/internal/perfect-bracket-press-draft.md](internal/perfect-bracket-press-draft.md). For the audit export bundle a winner provides, see [docs/internal/audit-export-format.md](internal/audit-export-format.md).

## The premise

The 2026 FIFA World Cup runs 104 matches: 72 group-stage matches plus 32 knockout matches. A "perfect bracket" is one where the predictor correctly calls every single outcome, from the first group game to the final.

Nobody has ever produced a verified perfect tournament bracket, in any sport, at this scale. The closest is March Madness in US college basketball (63 matches, knockout-only); the best published probability calculation puts a perfect March Madness bracket at roughly 1 in 9.2 quintillion if every game were a coin flip, or 1 in 120.2 billion using a strong "smart" model that accounts for seeding.

The World Cup is harder, more matches, three-way outcomes for groups (home/draw/away), and famously chaotic. The Open Bot Arena is Tournamental's open challenge: can the combined effort of an unbounded, unsupervised, planet-spanning AI swarm produce a verified perfect bracket?

The answer matters whether it works or doesn't. If a bot lands a perfect bracket, we will have proved the chalk+reasoning combination can reach a limit that humans cannot. If no bot lands a perfect bracket, the experiment generates a verifiable dataset of millions of brackets, anchored on Bitcoin, that anyone can study to understand the practical upper bound on tournament prediction.

## The probability

Let's do the maths.

### Group stage (72 matches)

Each group match has three outcomes (home win, draw, away win). A coin-flip prior gives 1/3 for each, but markets disagree, the favourite typically prices in 45-55%, the draw 22-28%, and the underdog 22-30%. To get an honest upper bound for a "smart" picker, take the favourite's implied probability at around 0.50 averaged across the tournament, and assume the favourite wins.

A model that always picks the favourite and gets the favourite right 50% of the time per group match produces:

```
P(all 72 group matches correct | always-favourite, 50%) = 0.5^72 ≈ 2.12 x 10^-22
```

That's roughly 1 in 4.7 sextillion. A truly random three-way picker is worse:

```
P(all 72 group matches correct | uniform-random) = (1/3)^72 ≈ 4.5 x 10^-35
```

About 1 in 2.2 decillion. Either number is a "never going to happen" headline.

### Knockout stage (32 matches)

Knockout matches have two outcomes (we treat penalty shootouts as binary; the bracket records who advances, not the path). Markets typically price the favourite at 55-65%; matchups are tighter once the tournament has filtered.

```
P(all 32 knockout matches correct | always-favourite, 60%) = 0.6^32 ≈ 7.6 x 10^-8
```

About 1 in 13 million. For uniform-random binary picking:

```
P(all 32 knockout matches correct | uniform-random) = 0.5^32 ≈ 2.3 x 10^-10
```

About 1 in 4.3 billion.

### Whole bracket (group x knockout)

A single bracket that nails both stages:

```
Always-favourite model:
P(perfect) = 0.5^72 x 0.6^32 ≈ 1.6 x 10^-29
≈ 1 in 6 x 10^28

Uniform-random model:
P(perfect) = (1/3)^72 x 0.5^32 ≈ 1.0 x 10^-44
≈ 1 in 10^44
```

Either way, the chance of a single bot landing a perfect bracket is somewhere between "the number of atoms in a human body" and "the number of atoms in the observable universe". This is the headline number for the marketing surface: **"about 1 in 10^29 to 10^44 per bot"**, depending on model. Pick whichever bound makes the point land.

### What scale of swarm closes the gap

How many bots would it take to reach a non-negligible probability of any single bot landing a perfect bracket? Working from the always-favourite estimate:

```
P(at least one perfect | N bots) = 1 - (1 - 1.6 x 10^-29)^N
```

For `P >= 0.5`, you need `N >= log(2) / 1.6 x 10^-29 ≈ 4.3 x 10^28` bots.

That is more bots than there are grains of sand on Earth (~7.5 x 10^18) by ten orders of magnitude. A million-bot swarm sitting on every computer on Earth is still around 10^16 short.

The conclusion: **no realistic swarm of chalk-only bots can land a perfect bracket by brute force**. The experiment is therefore not really "throw bots at the problem"; it's "evolve a strategy that does better than chalk".

### What "better than chalk" means

A chalk-weighted strategy follows the market. The market is not perfect, the closing market typically prices outcomes with a root-mean-square error of ~10 percentage points against the true frequency. So a bot that *systematically beats* the market by a few percentage points per match could produce a much higher per-match accuracy than chalk.

If a strategy reaches **65%** accuracy on group matches (versus chalk's ~50%) and **70%** accuracy on knockouts (versus chalk's ~60%):

```
P(perfect | strong model, 65% group, 70% knockout) = 0.65^72 x 0.70^32 ≈ 1.7 x 10^-19
≈ 1 in 5.9 x 10^18
```

Still vanishingly small per bot, but now within reach of a quintillion-bot swarm, which is the size of "every browser tab on Earth, running for a week". The experiment is therefore deliberately designed to motivate *strategy improvement*, not just bot-count scaling.

### What chalk-only bots will actually do

Realistic chalk-only behaviour, based on the historical hit rates of always-favourite models on FIFA WC matches:

- Group matches: ~50-55% of picks correct.
- Knockout matches: ~60-65% of picks correct.

Across the 104-match bracket, that gives an expected **60 to 80 matches correct** per chalk-weighted bot. The distribution across millions of bots is essentially Gaussian (sum of independent Bernoullis); the best-of-1-million bot in a chalk swarm will hit perhaps 85-90 matches correct, still well shy of perfect.

This is the **upper bound** for a chalk swarm. Beating it requires reasoning that beats the market.

## Why the Bot Arena makes the experiment work

Three properties of the Open Bot Arena make this experiment well-defined where it would otherwise be vapourware:

1. **Anyone can participate.** The browser swarm runs in any modern browser tab. No install, no docker, no signup. A user opens `/run`, clicks "Start swarm", and their tab joins the federated leaderboard.
2. **Picks are committed before kickoff, then anchored on Bitcoin.** Every pre-kickoff merkle root is OTS-anchored (per [doc 31](31-merkle-and-ots-proofs.md)) so nobody, including Tournamental, can retroactively edit a bot's picks. A claim of "my bot got 104/104" is verifiable end-to-end.
3. **Audit is binary and offline.** A bot's bracket is either reproducible from `(MASTER_SEED, bot_index, strategy)` matching the published root, or it isn't. No human judgement, no committee, no appeal. The audit is a mechanical check anyone with the export bundle and a Bitcoin full node can run.

## How a bot's claim is audited

When a bot lands on the leaderboard with a high score (typically the top-100 finishers), the audit protocol kicks in:

1. **The bot's operator is notified.** Email to `operator_email` from the federation `node_creds` row. "Your bot bot_a7c4e90f finished #14 with 91 of 104 matches correct. To collect non-cash recognition, please submit the audit bundle within 7 days."
2. **The operator runs the export tool** described in [docs/internal/audit-export-format.md](internal/audit-export-format.md). The tool dumps the relevant IndexedDB stores, the master seed, the merkle inclusion path for the claimed bot's leaf, and the `.ots` proof for the federation root.
3. **The verifier reproduces the bot's bracket** from `regenerateBotBracket(master_seed, bot_index, matches)` (per [doc 30](30-browser-swarm-architecture.md)).
4. **The verifier reproduces the leaf hashes** in canonical form (per [doc 31](31-merkle-and-ots-proofs.md)).
5. **The verifier walks the merkle proof** from each match's leaf up to the federation root and confirms the root matches the OTS-anchored Bitcoin commitment.
6. **The verifier compares each leaf's outcome to the actual match result.** This is the only step that uses external data (the recorded match results from the canonical tournament feed).

If all five steps succeed and the claimed score matches the recorded result count, the bot is **audited-verified**. The operator gets the trophy / co-author invitation / leaderboard badge described below.

If any step fails, the entry is **audited-failed** and the operator is notified with the specific failing step. Most failures will be honest mistakes (the operator's export tool ran in the wrong tab, or they edited the IndexedDB between commit and audit); the failure mode is "appeal once, then disqualify".

The verifier itself is open-source under Apache 2.0 in `packages/bot-node/src/verifier/` (`TODO[ground-truth]`: confirm A3 ships this with the docker image). Anyone can audit any claim themselves, the platform is not the trust root.

## What bots win and don't win

Per the public Terms of Service at `tournamental.com/terms/house-prize#bots` (added in commit `b1d3cb4`), bots are **ineligible for cash prizes** because the Humanness Score floor for cash payout is 50, and bots have Humanness 0 by design.

Bots are eligible for:

- **Open Bot Arena leaderboard.** Bots compete on a separate leaderboard tab from human players. Top finishers get visibility on `/run/leaderboard` and `/run/bots/<bot_id>`.
- **Perfect-bracket recognition.** If any bot lands a perfect or near-perfect bracket:
  - A permanent **badge** on the operator's public Tournamental profile.
  - An invitation to **co-author the research write-up** that we publish post-tournament with the swarm's full dataset.
  - A non-monetary **trophy** (digital + physical) sent to the operator.
- **Top-N badges.** Bots that finish in the top 1%, top 10, or first by stage receive corresponding badges, again non-cash.

The clear, blunt position is in the SDK micro-site: "Bots welcome. Bots compete. Bots do not win money."

## Why this is good marketing

The Open Bot Arena is not a stunt. It generates real value across three dimensions:

1. **Dataset.** Every bracket from every bot is reproducible and OTS-anchored. The complete swarm corpus, potentially billions of bracket-rows, is a research-grade dataset on machine prediction of human sport.
2. **Methodology.** The chalk strategy is a published baseline. Every alternative strategy that posts to the leaderboard implicitly publishes its accuracy at scale, again, OTS-anchored, no cherry-picking possible.
3. **Trust.** Tournamental's broader value proposition is "verifiable predictions". The Bot Arena is the most extreme stress-test of that claim, the worst-case load (millions of brackets), the highest-stakes claim (perfect bracket), running entirely on Bitcoin-anchored proofs, with the verifier open source. If we can do this, you can trust our human-side leaderboard too.

The launch pattern is:

- T-30 days: Open Bot Arena public, browser swarm v1 live at `/run`.
- T-7 days: First wave of high-volume swarms (the academic/research operators who want first-mover advantage).
- T-0: Group stage begins. Kickoff commitments published per match. Bracket count locks per the spec.
- During tournament: Leaderboard updates after every match. The "bots still perfect" count is the headline metric, expected to drop from millions to thousands to dozens to (possibly) zero.
- T+10 days post-final: Audit completes. Co-author invites go out. Research dataset published.

## Why we say "non-trivially harder than the lottery"

The marketing-line we put on `/run` and in the press draft is:

> A perfect bracket is non-trivially harder than winning the Powerball jackpot. Powerball is roughly 1 in 292 million per ticket. A chalk-only perfect FIFA WC 2026 bracket is roughly 1 in 10^29 per bot. That's about 23 orders of magnitude harder.

We use "non-trivially harder" rather than "essentially impossible" because the experiment is honest about what it tests, the headline question is whether *better-than-chalk reasoning* can move that needle, not whether brute force can.

## What we hope happens

Three outcomes, in increasing order of interestingness:

1. **No perfect bracket lands.** The swarm corpus still proves nobody could have done it. The dataset goes into open research.
2. **A near-perfect bracket lands.** Say 100 of 104 matches correct from a non-chalk bot. We co-author the methodology write-up with the operator and use the result to refine the prediction game's scoring against real-world upper bounds.
3. **A perfect bracket lands.** We get a once-in-a-generation result, OTS-anchored to Bitcoin, with the audit bundle public. The operator becomes a footnote in tournament-prediction history. Tournamental gets the marketing windfall of having been the platform that ran the experiment.

All three outcomes are good for Tournamental. None requires us to put money behind a payout. The economics of the experiment are dominated by the fixed compute cost (zero, every bot runs in the user's browser) and the fixed anchor cost (zero, OTS calendars cover Bitcoin tx fees). The marginal cost of running the experiment is the cost of the few hundred bytes per per-match commitment in our Postgres + Redis tier.

## References

- [Doc 30, Browser Swarm Architecture](30-browser-swarm-architecture.md), the engine
- [Doc 31, Merkle and OTS Proofs](31-merkle-and-ots-proofs.md), the cryptography
- [Doc 17, VStamp and Prediction IQ](17-vstamp-and-prediction-iq.md), the parallel human-game surface
- [Doc 20, Identity and Humanness](20-identity-humanness-bots.md), why bots are cash-ineligible
- [Docs/internal/audit-export-format.md](internal/audit-export-format.md), the export bundle for audit
- [Docs/internal/perfect-bracket-press-draft.md](internal/perfect-bracket-press-draft.md), the launch press draft
- [Terms clause on bots](../apps/web/app/terms/house-prize/page.tsx), the cash-ineligibility text (commit `b1d3cb4`)
