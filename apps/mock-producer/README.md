# @vtorn/mock-producer

> Owned by [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) section 4. See [docs/05-mock-producer.md](../../docs/05-mock-producer.md).

Node TypeScript synthetic match generator. Emits a deterministic stream of `MatchInit` + `StateFrame` + `EventMessage` shaped exactly like the StatsBomb-replay producer, suitable as a fast renderer-dev fixture.

This directory is currently a stub. The owning builder agent will fill it in per the prompt linked above. Do not implement here without coordinating with the orchestrator.

## Getting started (once the builder lands)

```bash
cd apps/mock-producer
pnpm start -- --seed=42 --out=ws --port=4002
```

## Spec contract

Consumes `@vtorn/spec` workspace dep. Emits a synthetic 90-minute match with goals, fouls, and substitutions.
