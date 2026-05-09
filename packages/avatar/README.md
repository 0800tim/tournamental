# @vtorn/avatar

> Owned by [AGENT-PROMPTS.md](../../AGENT-PROMPTS.md) section 3. See [docs/07-avatars-and-assets.md](../../docs/07-avatars-and-assets.md).

Procedural avatar pipeline. One shared body GLB. Runtime canvas-generated jersey textures (team colours + numbers). Billboard face quads with images sourced from Wikidata for the 22 starters of any given match. Asset bundles live alongside (the AR-FR 2022 starters are the v0.1 target — see doc 7).

This package is currently a stub. The owning builder agent will fill it in per the prompt linked above. Do not implement here without coordinating with the orchestrator.

## Consumers

- [`apps/web`](../../apps/web/) imports `@vtorn/avatar` for runtime avatar generation.
- The avatar pipeline does not consume `@vtorn/spec` directly — it is fed `Player` records by the renderer.
