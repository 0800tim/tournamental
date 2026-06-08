# @tournamental/seed-bots

Deterministic CLI that seeds ~18,000 cosmetic, humans-style bot accounts
into Tournamental so the leaderboard reads as populated from minute one
of the FIFA World Cup 2026 launch on 11 June.

**Important framing**: the 18k seed bots appear on the **Humans** tab of
the leaderboard, not the Bots tab. They are flagged `is_bot=1` and
`humanness_score=0` internally so they remain ineligible for the cash
prize (per `/terms/house-prize`), but render as humans on the public
surface. The Bots tab is reserved for federated-network bots without
user accounts (Phase 2).

Source of truth: `docs/superpowers/specs/2026-06-07-bot-arena-design.md` section 4.

## Quickstart

```bash
# Dry run: print validation summary, no DB writes.
pnpm --filter @tournamental/seed-bots run seed -- --target=18000 --dry-run

# Apply: write to all three stores.
pnpm --filter @tournamental/seed-bots run seed -- --target=18000 --apply

# Smoke test on a small cohort:
pnpm --filter @tournamental/seed-bots run seed -- --target=100 --dry-run

# Roll back everything (idempotent; safe to re-run):
pnpm --filter @tournamental/seed-bots run seed -- --purge
```

The CLI exits non-zero when any of the validation targets miss by more
than 2 percentage points, so a re-run after editing the algorithm can't
silently land a regression.

## What gets created

Per bot, with deterministic ids of the form `bot_<8-char-base32>`:

| Store | Surface | Payload |
| --- | --- | --- |
| `apps/auth-sms` | `user` table | `id`, `display_name`, `country`, `first_name`, `last_name`, `favourite_team_code`, `created_at`, `last_seen_at`, `is_bot=1` |
| `apps/identity` | `humanness-scores.jsonl` | `{ userId, score: 0, factors: [seed_bot], computedAt }` |
| `apps/game` | `brackets` table | locked bracket with 104 match predictions + cup-winner, deterministic `share_guid`, `locked_at` from the bot's last save event |

`is_bot` and the humanness JSONL ride on Agent A1's auth-sms migration.
This CLI defensively adds the `is_bot` column if it does not yet exist,
so seed runs are order-independent against A1.

## Algorithm (spec section 4 in one paragraph)

1. Roll a personality: `chalk_score` from a truncated normal with mean
   0.78 in [0.65, 0.90] plus an engagement tier (10% high, 30% medium,
   60% low).
2. Roll a favourite team from the cup-winner prior.
3. Roll an identity: country (25% UK/IE, 15% USA, 10% AU/NZ, 8% BR/AR,
   balance across 22 locales), first name + last name from the
   country's public-domain corpus, handle composed as
   `firstname_<team3>_<NN>`.
4. Pick an avatar: 33% AI-faces, 33% Dicebear SVG, 34% initials.
5. Pick every match using
   `favourite_p = chalk_score + (chalk_score - 0.5) * stage_amp`
   clamped to the stage's range, with a +0.06 draw bias on group
   matches. Cup winner is sharpened from the prior by raising each
   nation's probability to `1 + 4 * (chalk_score - 0.5)` and
   renormalising.
6. Roll an activity timeline: ~33% backdated 26 May - 6 June,
   ~67% ramping 7 - 11 June, clustered evenings / weekends / press
   dates. High-engagement bots save 3-5 times, medium 1-2, low once.

The master seed is hardcoded at `tournamental-2026-seed-v1`. Override
with `--seed=<string>` for development experiments only; production
must use the canonical seed so re-runs are stable.

## Validation targets

- Favourite rate: 75% +- 2pp
- Group draw rate: 15% +- 2pp
- Top-6 cup winner concentration (BRA, FRA, ARG, ENG, ESP, GER): >= 82%

If any of these miss on the generated cohort, the CLI prints `FAIL` and
exits 1 before touching any store. The test suite enforces the same
bounds on a 100-bot smoke cohort at +-3pp (sampling noise is bigger on
n=100).

## Idempotency

- Bot ids are derived deterministically from the master seed and the
  index, so a re-run with the same `--target` writes the same ids.
- `auth-sms.user` upsert uses `ON CONFLICT(id) DO UPDATE`.
- `humanness-scores.jsonl` skips existing entries on re-write.
- `game.brackets` upsert uses `ON CONFLICT(id) DO UPDATE`.

`--purge` removes every `bot_%` row from all three stores. Safe to run
mid-tournament if we ever need to nuke and reseed.

## Tests

```bash
pnpm --filter @tournamental/seed-bots test
```

Asserts:
- 100 bots are byte-deterministic across two runs.
- 100 bots pass the validation targets within +-3pp.
- 200 bots respect the engagement tier weights.
- handles always have shape `firstname_team3_NN`.

## Data files

- `data/names/<country>.json`: public-domain first + last name corpora,
  one file per country code. Eleven files bundled at v0.1; the 22-locale
  distribution falls back to cultural-neighbour corpora for any code
  without a dedicated file.
- `data/odds-snapshot.json`: frozen probability snapshot for the 104
  matches plus the cup-winner prior. Generated offline from the
  canonical fixtures with `scripts/build-odds-snapshot.py`.
- `data/avatars/faces/`: placeholder for the synthetic 6,000-image face
  set Tim ships out-of-band. The CLI itself only writes URL pointers.

## File layout

```
apps/seed-bots/
  README.md
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts          (CLI entry)
    seed.ts           (orchestrator)
    personalities.ts  (chalk_score + engagement_tier roller)
    names.ts          (country-weighted identity roller)
    avatars.ts        (3-pool avatar picker)
    brackets.ts       (per-match algorithm)
    timeline.ts       (created_at + save events)
    write.ts          (three-store writer + purger)
    rng.ts            (deterministic PRNG helpers)
  data/
    names/{ar,au,br,de,es,fr,gb,ie,it,jp,nz,us}.json
    odds-snapshot.json
    avatars/faces/.gitkeep
  scripts/
    build-odds-snapshot.py
  test/
    seed.test.ts
```
