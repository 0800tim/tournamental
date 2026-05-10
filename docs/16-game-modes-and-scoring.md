# 16 — Game Modes and Scoring

> The rulebook. Ten game modes, the scoring formula that makes them all interoperable, the multipliers, the streaks, the confidence mechanic, and the personality leaderboards. Brand framing is in [doc 15](15-tournamental-brand-and-positioning.md); the engine that runs all of this lives in `apps/game-service` per agent J ([doc 09](09-agent-task-breakdown.md)).

## The unifying score formula

Every prediction in every mode resolves through one base formula plus a stack of multipliers. This is the design centre — once a developer or a player understands this, everything else is variations on a theme.

```
points_awarded = round(
  base_points
    × time_multiplier
    × confidence_multiplier
    × stage_multiplier
    × streak_multiplier
    × mode_multiplier
)
```

Each factor is bounded and explicit so the leaderboards stay legible.

### Base points (skill, measured against the market)

```
base_points = 100 × (1 - market_implied_probability_at_lock)
```

A prediction that the market thought was 90% likely → 10 points. A prediction the market thought was 5% likely → 95 points. Calling a 50/50 → 50 points. **Skill is measured by how much you knew that the market didn't, at the moment you locked.**

If the market doesn't have a tradable line for the predicted outcome (e.g. an exact-score on a regional fixture), use the closest proxy — typically the expert/AI model probability — and tag the prediction `proxy_probability: true` so leaderboards can filter / weight differently.

### Time multiplier (early conviction beats late conviction)

```
pre_match (>30min before kickoff)        → 1.50×
pre_match (kickoff to start)              → 1.25×
first_third_of_match                      → 1.10×
middle_third                              → 1.00×
last_third                                → 0.50×
final_minutes (last 10%)                  → 0.10×
```

Locking the right call early is hard *because* you're locking before more information arrives. Late locks get a shrinking multiplier so users can't game the system by waiting until the result is obvious.

### Confidence multiplier

If the user explicitly assigned a confidence level (1–5 stars) — see Confidence Chips below.

```
confidence 1 → 1.00×
confidence 2 → 1.10×
confidence 3 → 1.20×
confidence 4 → 1.30×
confidence 5 → 1.50×
```

Wrong predictions at higher confidence cost more chips; right predictions earn more points. Forces the user to allocate attention.

### Stage multiplier

Tournament-stage weighting. Calling the final correctly *should* be worth more than calling a group-stage opener.

```
group_stage         → 1.00×
round_of_16         → 1.25×
quarter_final       → 1.50×
semi_final          → 2.00×
final               → 3.00×
```

For tournaments without elimination structure (round-robin leagues), this is `1.00×` everywhere unless a campaign overrides it.

### Streak multiplier

A small bonus that compounds with consecutive correct predictions. See "Streak tiers" below.

```
0–2 streak  → 1.00×
3–4 streak  → 1.10×
5–9 streak  → 1.20×
10–14       → 1.30×
15–19       → 1.40×
20+         → 1.50×
```

Cap at 1.50× so a user who is genuinely good doesn't snowball into uncontested first place; the per-prediction skill score still has to be there.

### Mode multiplier

Each game mode adds its own coefficient (most are `1.0`; a few signature modes have higher weights to encourage participation). Listed per-mode below.

## The ten game modes

### 1. Full Tournament Prophet

Pre-tournament long-form predictions. The brackety, single-shot, "I'm going to commit to a story for the whole tournament" mode.

Predictions:
- Tournament winner
- Runner-up
- Semi-finalists (set of 4)
- Group winners (one per group)
- Top scorer
- Player of the tournament
- Biggest upset (named match)
- Dark horse (a low-implied-probability team to make the final 8)
- First major team eliminated (the highest-seeded team to go out first)
- Total goals / points / runs across the tournament (over/under threshold)
- Final match exact score
- **Perfect bracket** — the headline (worth a tournament-defining bonus, see mode 5)

**Mode multiplier**: 1.0× for individual sub-predictions. The Perfect Bracket lock has its own bonus structure.

**Lock**: at tournament kickoff. No edits after.

**Special scoring**: the *earlier* the prediction is locked relative to tournament start (we open prediction submission 2–4 weeks ahead), the higher the time multiplier, capped at 1.5×. This rewards conviction before the consensus settles in.

### 2. Match Predictor

The simple, casual, lowest-friction mode. One match, basic predictions.

Predictions:
- Match winner (Home / Draw / Away)
- Final score
- Winning margin
- Total goals / points (over/under)
- First team to score
- Half-time result
- Player to score
- Player of the match

**Mode multiplier**: 1.0×.

**Lock**: at kickoff.

This is the default mode in the bot's `/predict` flow. Goal: ≤4 taps. Casual users see only this mode; serious users layer the others on top.

### 3. Live Match Predictor

Real-time in-match prediction prompts. The mode that keeps the user engaged for 90+ minutes.

Prompts (issued contextually by the game service):
- Who wins from here?
- Who scores next?
- Will the favourite choke?
- Will the underdog hold on?
- Will the market flip during this match?
- Will this go to extra time?
- Will the current leader still win?
- Will there be another goal / try / wicket / point?
- Will the implied probability cross 70% / 80% / 90% before full-time?

**Mode multiplier**: 1.0×.

**Lock**: instant on submit (the prompt's window has already started).

The game service emits Live prompts based on event-stream patterns: a goal triggers "will there be another in the next 10 min?"; a yellow card in the box triggers "will VAR overturn it?"; etc. Prompt templates per sport live in `apps/game-service/prompts/live-prompts/`.

### 4. Beat the Market

The flagship skill mode, and the centre of the brand. This isn't a separate game so much as a *lens* on top of every other mode — the user explicitly opts to be scored using the market-difficulty formula, *with no time/stage/streak fluff*.

```
beat_the_market_points = base_points  ×  early_lock_bonus_only
```

A separate Beat the Market leaderboard surfaces only these scores. Players who climb it are demonstrably reading market mispricings, not just picking favourites in the easy modes.

**Mode multiplier**: 1.5× (signature mode). This is intentional — we want users to opt into pure-skill scoring.

### 5. Perfect Tournament Challenge

The viral hook. Track every user's running streak of correct match predictions across the whole tournament.

- **Perfect Match Day** — every match on a single day correct.
- **Perfect Round** — every match in a tournament round correct.
- **Perfect Group Stage** — every group-stage match correct.
- **Perfect Knockout Stage** — every knockout match correct.
- **Perfect Tournament** — every match in the tournament correct (the headline).

Live status banner on the user's profile and in the bot:

```
Perfect Run: 12 / 12 correct
Still alive
Rank: #47 globally   #3 in your country
```

When the streak ends:

```
Perfect Run Ended
Final: 12 / 13 correct
Top 2% of all players in this tournament
```

**Bonus structure** (in addition to per-prediction points):
- Perfect Match Day: +500 bonus.
- Perfect Round: +2,000 bonus.
- Perfect Group Stage: +5,000 bonus.
- Perfect Knockout Stage: +10,000 bonus.
- **Perfect Tournament: +100,000 bonus** (or a sponsor-provided physical prize where available; see [doc 15](15-tournamental-brand-and-positioning.md)).

**Mode multiplier**: each prediction inside an active perfect run gets a 1.05× multiplier on top of its other multipliers. Small enough not to dominate the casual leaderboard; meaningful when stacked.

The publicness of the run is a feature: a user "still alive at 23/24" is a shareable card, and a user's elimination is a meme.

### 6. Prediction Streaks

A simpler, daily-life-flavoured streak that doesn't require a tournament structure. Just consecutive correct predictions across any matches the user predicted, anywhere on the platform.

Tier ladder:

```
3  consecutive correct → "Hot Hand"
5                       → "Sharp"
10                      → "Oracle"
15                      → "Market Killer"
20                      → "Tournament God"
30                      → "Untouchable"
50                      → "Legend"
```

Streak multiplier (already shown in the unifying formula) compounds with each tier. Streak resets on the first incorrect prediction; "Streak Protection" — a single insurance use — is purchasable at 0 cost (game mechanic, no money) by spending 5 unused Confidence Chips. Forces a strategic decision: do I save my chips, or insure my streak?

### 7. Confidence Chips

Each user gets a fixed allocation of confidence chips per tournament — say **100 chips for a World Cup**. Chips are a currency-like *game* mechanic. Critically, **they are never redeemable for anything outside the game**.

Mechanics:
- The user can stake 1–5 chips on any prediction (this is the confidence multiplier from the formula).
- Correct prediction returns the chips + points multiplier.
- Wrong prediction loses the chips.
- Once chips are spent, they're gone for the tournament.
- The pre-tournament bracket (Tournament Prophet) requires chip allocation across long-form predictions.

This adds a strategic layer: users who blow their chips on early favourites have nothing left for the late-stage upsets. Users who hoard chips can't capture early conviction bonuses. Skill = chip management as much as prediction accuracy.

**Mode multiplier**: not a standalone mode; modifies the others.

### 8. Market Timing Score

A second skill-flavoured leaderboard, distinct from Beat the Market. Where Beat the Market scores how *contrarian* the call was, Market Timing scores how *early* relative to the market move.

Mechanic:
- At lock, store `market_implied_at_lock`.
- Sample the market every minute until the prediction resolves.
- If the prediction wins: bonus points proportional to how much the market moved *toward* the predicted outcome between lock and resolution.

```
timing_bonus = 100 × max(0, market_implied_at_resolution_window - market_implied_at_lock)
```

Example:
- User locks Team B at 21% implied.
- Market drifts to 68% by full-time.
- Team B wins.
- Timing bonus: `100 × (0.68 − 0.21) = 47` points on top of the base.

Badges associated:
- **Early Signal** — caught a move ≥30%.
- **Before the Crowd** — prediction was below median crowd-prediction at the time, and won.
- **Market Mover** — your locked prediction preceded a >15% market move within 5 minutes.
- **Bought the Dip** — locked at a momentary trough in implied probability.
- **Ice Veins** — held a low-probability call through a market spike against you, and won.
- **Called the Comeback** — locked the eventual winner while they were trailing.

**Mode multiplier**: 1.2× (signature, but less than Beat the Market — this is additive flavour, not a separate game).

### 9. Comeback Radar

Reactive prompts during emotional live moments. The game service watches the spec event stream for triggers and pushes a Live prompt to subscribed users.

Triggers and prompts:

| Trigger | Prompt |
|---------|--------|
| Goal in last 10 min, score level | "Will this go to extra time?" |
| Underdog scores first | "Is this comeback real? Will the underdog hold the lead?" |
| Favourite trailing > 1 score, > 70% match elapsed | "Will the favourite still win?" |
| Market shifts > 20% in 60 seconds | "Will the market reverse before full-time?" |
| Red card given | "Does the team with 11 still win?" |
| Penalty awarded | "Will the kicker score?" |

Each prompt is a 30-second-window prediction, locks immediately, resolves on the next relevant event. Higher-than-baseline base-multiplier (`1.15×`) because they're inherently low-information.

**Mode multiplier**: 1.15×.

### 10. Crowd vs Market vs Experts

Not a prediction mode the user *plays* but a public display layer that shows up next to every match.

For each match we publish three implied probabilities:

1. **Tournamental Crowd** — aggregate of all Tournamental user predictions on that outcome at lock time. Median, not mean (robust to whales).
2. **Market** — Polymarket implied probability or median of Bookmaker odds via The Odds API.
3. **AI Model** — our own simple Elo-ish + form-adjusted model. Transparent: we publish the model's logic.

After the match, the post-match share card shows which layer was right:

```
Argentina v France (final score: 3–3, 4–2 pens)
  Tournamental Crowd:  Argentina 58%
  Market:       Argentina 62%
  AI Model:     Argentina 51%
  Result:       Argentina won
  → Market called it best.
```

Or the more shareable scenario:

```
Saudi Arabia v Argentina (final score: 2–1)
  Tournamental Crowd:  Argentina 73%
  Market:       Argentina 89%
  AI Model:     Argentina 81%
  Result:       Saudi Arabia won
  → All three were wrong. The contrarians cleaned up.
```

This is auto-content for socials and adds drama without requiring user action.

## Streak tiers (canonical)

These tier names are the source of truth referenced from the formula and from the badges system in [doc 12](12-odds-and-predictions.md).

```
3  → Hot Hand
5  → Sharp
10 → Oracle
15 → Market Killer
20 → Tournament God
30 → Untouchable
50 → Legend
```

Names appear in HUD banners, share cards, profile pages, and bot notifications.

## Personality leaderboards

Beyond the standard global / country / city / friend / pool / tournament / round / day leaderboards (specced in [doc 12](12-odds-and-predictions.md)), Tournamental ships **personality-flavoured leaderboards**. Each is a distinct ranked board scoped to a specific *style* of prediction. Players naturally specialise; many users will never make it onto the global board but will dominate one of these.

| Leaderboard | Definition | Why it matters |
|-------------|------------|----------------|
| **The Oracle** | Highest overall accuracy across all locked predictions. | Headline accuracy. The "I called it" board. |
| **The Shark** | Highest Market Timing Score. | Sharpest movers. |
| **The Contrarian** | Most correct underdog (<30% implied) calls in the tournament. | The contrarian-of-the-month vibe. |
| **The Loyalist** | Highest accuracy on a single team. | Country / club fans love this one. |
| **The Ice Man** | Highest accuracy on predictions locked in the last 20% of match time. | Late-game readers. |
| **The Comeback King** | Most correct comeback predictions (Comeback Radar). | Live-watching specialists. |
| **The Data Nerd** | Highest expected-value score (sum of `prob_assigned × outcome - prob_assigned × (1-outcome)` across all predictions). | The quant flavour. |
| **The Chaos Merchant** | Most correct predictions at <10% implied probability. | Pure ridiculous luck-or-genius. |
| **The Market Killer** | Highest sum of base_points (the unweighted Beat-the-Market score). | The cleanest skill metric. |

Every user has a personality-leaderboard summary on their profile so even if global rank is unimpressive, they can flex on their archetype.

## Cards and feedback

Every locked prediction generates a card (rendered server-side as PNG, 1:1 and 9:16 variants, per [doc 12](12-odds-and-predictions.md)). Templates:

### Locked

```
Prediction Locked
France to win
Locked: 62nd minute
Market odds at lock: 38%
Confidence: 8 / 10
Potential score: 84 points
VStamp: #A92F-81C
```

### Won

```
Prediction Won
France won 2–1
You locked France at 38%
You beat 82% of Tournamental users
Points earned: 84
Badge earned: Before the Crowd
Streak: 7  →  Hot Hand
```

### Lost

```
Prediction Lost
You picked Brazil at 71%
Final result: Croatia won
Market moved against you after 78 min
Streak ended at 4
```

The lost variant is intentionally not punishing — keep the user playing.

## API surface (from agent J)

The game service exposes a small REST surface (used by the web app, the bot, and any partner integrations). All requests are authenticated via the user's session JWT.

```
POST   /api/predictions                    create a prediction
GET    /api/predictions/:id                read one
GET    /api/users/:id/predictions          history
POST   /api/predictions/:id/verify         force-resolve VStamp lookup

GET    /api/matches/:id/odds               current consolidated odds
GET    /api/matches/:id/crowd-prediction   median crowd prediction

GET    /api/tournaments/:id/leaderboard?board=global|country|city|friends|...
GET    /api/leaderboards/personality/:name?tournament=...

GET    /api/users/:id/profile              public profile
GET    /api/users/:id/prediction-iq        Prediction IQ summary (doc 17)

POST   /api/pools                          create pool
POST   /api/pools/:id/join                 join via invite code
GET    /api/pools/:id/leaderboard          private pool board
```

Read paths primarily hit CDN JSON snapshots (per [doc 12](12-odds-and-predictions.md)); these REST endpoints are for write paths and rare ad-hoc reads.

## Acceptance criteria

- [ ] Every prediction lock stores `market_implied_at_lock`, `t_lock_ms`, and the full multiplier breakdown so points can be recomputed if a multiplier rule changes.
- [ ] Scoring engine produces identical outputs for identical inputs (deterministic).
- [ ] All ten modes run through the same `score_prediction(prediction, resolution)` function — no special cases scattered through the code.
- [ ] Personality leaderboards are computed on every snapshot tick from the same prediction history.
- [ ] Confidence chips can never go negative and never go above the per-tournament cap.
- [ ] Streak protection consumes exactly 5 chips and is allowed at most once per streak.
- [ ] Perfect Tournament tracker is correct after a settlement edge case (e.g. an abandoned match — predictions void without breaking the streak).
- [ ] Beat the Market and Market Killer leaderboards never include matches with `proxy_probability: true` (those flags taint the market measurement).
