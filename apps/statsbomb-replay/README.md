# statsbomb-replay

> Owned by [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) section 1. See [docs/11-historic-data-sources.md](../../docs/11-historic-data-sources.md).

Python service that converts StatsBomb open data for the **2022 FIFA World Cup Final, Argentina vs France** into the canonical VTourn message stream (`@vtorn/spec` v0.1.1). Emits over WebSocket, writes NDJSON to disk, or pipes JSON-per-line to stdout.

The Argentina-France final is the v0.1 demo headline match. This producer streams a spec-conformant sequence including regulation goals (Messi pen 23', Di María 36', Mbappé pen 80', Mbappé 81', Messi 108', Mbappé pen 118') and the ARG 4–2 penalty shoot-out finish.

## Layout

```
apps/statsbomb-replay/
├── pyproject.toml                  # uv-managed; numpy + scipy + websockets + pydantic
├── data/
│   └── wc2022-final-players.csv    # 22 starters, Wikidata Q-numbers, Commons photo URLs
├── src/statsbomb_replay/
│   ├── __init__.py                 # SPEC_VERSION + match defaults
│   ├── coords.py                   # SB 120x80 → spec 105x68 metres helpers
│   ├── loader.py                   # read open-data files (with raw.gh fallback)
│   ├── photos.py                   # CSV → {sb_player_id: PlayerPhoto} lookup
│   ├── mapping.py                  # SB structures → spec MatchInit + EventMessage
│   ├── state_synth.py              # 360 frames + Hungarian assignment → 10Hz states
│   ├── emitter.py                  # full stream builder with score / pens bookkeeping
│   └── replay.py                   # CLI entry-point
└── tests/
    ├── fixtures/                   # pinned StatsBomb-event-shape JSONs
    ├── test_mapping.py             # parsing-correctness unit tests
    └── test_emitter_integration.py # full-match integration (skipped without STATSBOMB_DATA)
```

## Install

```bash
cd apps/statsbomb-replay
uv sync
```

## Run

```bash
# Replay the AR-FR final (downloads only the four required JSON files
# from raw.githubusercontent.com on first run; subsequent runs use the
# local cache):
uv run python -m statsbomb_replay.replay \
  --statsbomb-data ./statsbomb-open-data \
  --time-scale 10 \
  --out ws --port 4001

# Equivalent file output:
uv run python -m statsbomb_replay.replay \
  --statsbomb-data ./statsbomb-open-data \
  --out file --path ./out

# Smoke (no streaming, just stats):
uv run python -m statsbomb_replay.replay \
  --statsbomb-data ./statsbomb-open-data \
  --dry-run
```

CLI flags:

| flag | default | meaning |
|------|---------|---------|
| `--match-id`        | `fifa-wc-2022-final-arg-fra-2022-12-18` | slug embedded in `MatchInit.match_id` |
| `--statsbomb-data`  | `./statsbomb-open-data` | path to a clone (or empty dir; we fetch on demand) |
| `--time-scale`      | `10`    | wall-clock playback speed multiplier |
| `--out`             | `stdout` | one of `ws`, `file`, `stdout` |
| `--port`            | `4001`  | WebSocket port |
| `--path`            | `./out` | NDJSON output directory |
| `--no-fetch`        | off     | disable remote fetch fallback |
| `--dry-run`         | off     | build + summarise; do not stream |
| `--verbose`         | off     | DEBUG logging |

## Spec contract

This producer emits messages defined in [`packages/spec`](../../packages/spec/) at `SPEC_VERSION = "0.1.1"`. The renderer in [`apps/web`](../web/) consumes them. Penalty shoot-out events (`event.penalty_shootout_start`, `event.penalty_attempt`, `event.penalty_shootout_end`) were added in v0.1.1 specifically for this match.

## Tests

```bash
uv run pytest                    # unit tests (always run)

# Integration (requires StatsBomb data clone or cache):
STATSBOMB_DATA=./statsbomb-open-data uv run pytest -v
```

## Acceptance criteria coverage

- Streams a spec-valid sequence for the full AR-FR final including ET and pens. ✓
- Final `event.score_change` carries 3-3 at 90+ET. ✓
- Final `event.penalty_shootout_end` carries Argentina, 4-2. ✓
- All major event timestamps within the actual match timeline (StatsBomb-derived; no clock drift introduced by this producer). ✓
- `time-scale=10` runs the entire match in ~15 wall minutes. ✓ (150 min match clock / 10 = 15 wall min).

## Limitations and follow-ups

See [IDEAS.md](../../IDEAS.md) for parked enhancements:
- Multi-match support (currently hard-codes ARG/FRA team identity).
- High-fidelity tracking via SkillCorner cross-validation.
- Photo lookup table is hand-curated; future automation via Wikidata SPARQL is desirable.
- State-frame interpolation is linear; a Bezier arc for ball trajectories would look better on shots.
