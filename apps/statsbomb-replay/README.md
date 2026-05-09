# statsbomb-replay

> Owned by [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) section 1. See [docs/11-historic-data-sources.md](../../docs/11-historic-data-sources.md).

Python service that converts StatsBomb open data for the **2022 FIFA World Cup Final, Argentina vs France** into the canonical VTorn message stream (`@vtorn/spec` v0.1.1). Emits over WebSocket or to an NDJSON file.

This directory is currently a stub. The owning builder agent will fill it in per the prompt linked above. Do not implement here without coordinating with the orchestrator.

## Getting started (once the builder lands)

```bash
cd apps/statsbomb-replay
uv sync
uv run python replay.py \
  --match=fifa-wc-2022-final-arg-fra-2022-12-18 \
  --time-scale=10 \
  --out=ws --port=4001
```

## Spec contract

This producer emits messages defined in [`packages/spec`](../../packages/spec/) at `SPEC_VERSION = "0.1.1"`. The renderer in [`apps/web`](../web/) consumes them.

Penalty shoot-out events (`event.penalty_shootout_start`, `event.penalty_attempt`, `event.penalty_shootout_end`) were added in v0.1.1 specifically for this match.
