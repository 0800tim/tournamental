# @tournamental/spec

[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Canonical SimulatedSports message spec used by every Tournamental
producer (live match feed, replay tooling, mock data) and every
Tournamental renderer (web 3D scene, clip pipeline, share cards).

A spec stream is three message kinds in one ordered channel:

- `MatchInit` — sent once at stream start; static scene description.
- `StateFrame` — sent at 10 to 30 Hz; positions of all players and the
  ball.
- `EventMessage` — irregular; discrete game events that drive animations
  and HUD updates (passes, shots, goals, fouls, and so on).

Full background: [docs/02-spec.md](https://github.com/0800tim/tournamental/blob/main/docs/02-spec.md)
in the main repo.

## Install

```bash
npm install @tournamental/spec
```

## 30-second example

```ts
import {
  SPEC_VERSION,
  type MatchInit,
  type StateFrame,
  type EventMessage,
} from "@tournamental/spec";

console.log("Spec version:", SPEC_VERSION);

function isGoal(event: EventMessage): boolean {
  return event.kind === "goal";
}

const init: MatchInit = {
  kind: "match-init",
  // ... see types for full shape
} as MatchInit;
```

## What this gives you

- Type-safe consumption of any Tournamental stream.
- The shared coordinate system, time base, and ID conventions that every
  producer and renderer must agree on.
- A versioned contract: `SPEC_VERSION` lets renderers refuse streams they
  cannot speak.

## Stability

Pre-1.0 the spec may evolve. Breaking changes are signalled in
[CHANGELOG.md](./CHANGELOG.md) with a minor bump (0.x.0 -> 0.(x+1).0).
Post-1.0 we follow strict semver.

## Open source and contributor revenue

Tournamental is Apache-2.0 licensed. Contributors share platform revenue
through Drips Network. Read
[docs/19-open-source-and-contributor-revenue.md](https://github.com/0800tim/tournamental/blob/main/docs/19-open-source-and-contributor-revenue.md)
for how that works.

## Repo and docs

- Source: <https://github.com/0800tim/tournamental>
- Site: <https://tournamental.com>
- Issues: <https://github.com/0800tim/tournamental/issues>

## Licence

Apache-2.0. See [LICENSE](./LICENSE).
