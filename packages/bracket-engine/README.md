# @tournamental/bracket-engine

[![Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Pure-function bracket prediction engine for Tournamental. Powers the
FIFA World Cup 2026 bracket prophet flow in the browser and the API.

Surface:

- `tournament` -- Tournament, Team, Group, KnockoutFixture types.
- `cascade` -- resolve a partial prediction's downstream tree against a
  tournament plus optional actual results.
- `score` -- long-shot-rewarding score model (docs/16, docs/24).
- `standings` -- group-stage standings calculator.
- `vstamp` -- content-hashed, signed prediction-receipt envelope.
- `fixtures-2026` -- vendored FIFA WC 2026 tournament JSON.

Full background:
[docs/16-game-modes-and-scoring.md](https://github.com/0800tim/tournamental/blob/main/docs/16-game-modes-and-scoring.md)
and
[docs/17-vstamp-and-prediction-iq.md](https://github.com/0800tim/tournamental/blob/main/docs/17-vstamp-and-prediction-iq.md).

## Install

```bash
npm install @tournamental/bracket-engine @tournamental/spec
```

## 30-second example

```ts
import { loadFixtures2026 } from "@tournamental/bracket-engine";
import { cascadeBracket } from "@tournamental/bracket-engine/cascade";
import { scoreBracket } from "@tournamental/bracket-engine/score";

const tournament = loadFixtures2026();

// User pre-picks just the final
const userPicks = {
  winners: { FINAL: "ARG" },
};

// Cascade fills in the implied earlier rounds
const cascaded = cascadeBracket(tournament, userPicks);

// Score against (partial or complete) actual results
const score = scoreBracket(tournament, cascaded, /* actuals */ {});
console.log(score.totalPoints);
```

## Subpath imports keep client bundles small

`vstamp` imports `node:crypto`, so it is NOT re-exported from the package
root. Browser bundles only need `tournament`, `cascade`, `score`,
`standings`. Server-side consumers import VStamp directly:

```ts
import { signBracket } from "@tournamental/bracket-engine/vstamp";
```

## Open source and contributor revenue

Tournamental is Apache-2.0 licensed. Contributors share platform revenue
through Drips Network. See
[docs/19-open-source-and-contributor-revenue.md](https://github.com/0800tim/tournamental/blob/main/docs/19-open-source-and-contributor-revenue.md).

## Repo and docs

- Source: <https://github.com/0800tim/tournamental>
- Site: <https://tournamental.com>
- Issues: <https://github.com/0800tim/tournamental/issues>

## Licence

Apache-2.0. See [LICENSE](./LICENSE).
