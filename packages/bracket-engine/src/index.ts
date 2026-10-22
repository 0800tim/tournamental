/**
 * @tournamental/bracket-engine -- pure-function bracket prediction engine.
 *
 * Used by the browser UI for the FIFA WC 2026 bracket prophet flow and
 * by the API service when settling brackets at tournament end.
 *
 *   - `tournament` — Tournament / Team / Group / KnockoutFixture types.
 *   - `cascade`    — resolve a partial prediction's downstream tree
 *                    against a tournament + optional actual results.
 *   - `score`      — long-shot-rewarding score model (docs/16, docs/24).
 *   - `vstamp`     — content-hashed, signed prediction-receipt envelope.
 *   - `loadFixtures2026()`, `loadFixturesRwc2027()`, `loadFixtures(id)` —
 *     loaders for the vendored fixture JSON, returning a typed Tournament.
 */

export * from "./tournament.js";
export * from "./cascade.js";
export * from "./score.js";
export * from "./standings.js";
export * from "./bridge.js";
export {
  loadFixtures,
  loadFixtures2026,
  loadFixturesRwc2027,
  VENDORED_TOURNAMENT_IDS,
  type VendoredTournamentId,
} from "./fixtures-loader.js";
// NOTE: `./vstamp` is NOT re-exported here because it imports
// `node:crypto`. Browser bundles only need cascade + score + tournament.
// Server-side consumers (the API, replay tooling) import vstamp directly:
//
//   import { signBracket } from "@tournamental/bracket-engine/vstamp";
//
// This keeps client bundles small and avoids "node:" scheme errors in
// webpack.
