# @vtorn/web

> Owned by [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) section 2. See [docs/04-renderer.md](../../docs/04-renderer.md).

Next.js + React Three Fiber renderer. Connects to a producer's spec stream (e.g. [`apps/statsbomb-replay`](../statsbomb-replay/) for the AR-FR 2022 demo, or [`apps/mock-producer`](../mock-producer/) for synthetic data) and renders pitch + 22 procedural-avatar players + ball + HUD.

This directory is currently a stub. The owning builder agent will scaffold a Next.js app here per the prompt linked above. Do not implement here without coordinating with the orchestrator.

## Getting started (once the builder lands)

```bash
cd apps/web
pnpm dev
# open http://localhost:3000/match/fifa-wc-2022-final-arg-fra-2022-12-18
```

## Spec contract

Consumes `@vtorn/spec` workspace dep. Reads `MatchInit` once, then `StateFrame` at 10–30 Hz and `EventMessage` irregularly.
