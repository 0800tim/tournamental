/**
 * @vtorn/bracket-engine — pure-function bracket prediction engine.
 *
 * Used by the browser UI for the FIFA WC 2026 bracket prophet flow and
 * by the API service when settling brackets at tournament end.
 *
 *   - `tournament` — Tournament / Team / Group / KnockoutFixture types.
 *   - `cascade`    — resolve a partial prediction's downstream tree
 *                    against a tournament + optional actual results.
 *   - `score`      — long-shot-rewarding score model (docs/16, docs/24).
 *   - `vstamp`     — content-hashed, signed prediction-receipt envelope.
 *   - `loadFixtures2026()` — convenience loader for the vendored 2026 WC
 *     fixtures JSON, returning a typed Tournament.
 */

export * from "./tournament.js";
export * from "./cascade.js";
export * from "./score.js";
export { loadFixtures2026 } from "./fixtures-loader.js";
// NOTE: `./vstamp` is NOT re-exported here because it imports
// `node:crypto`. Browser bundles only need cascade + score + tournament.
// Server-side consumers (the API, replay tooling) import vstamp directly:
//
//   import { signBracket } from "@vtorn/bracket-engine/vstamp";
//
// This keeps client bundles small and avoids "node:" scheme errors in
// webpack.
