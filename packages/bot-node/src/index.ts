/**
 * @tournamental/bot-node - federated Tournamental bot node.
 *
 * Library entrypoint. The CLI lives at `./cli.ts`.
 */

export * from "./types.js";
export {
  Storage,
  type StorageOptions,
  type SwarmRunRow,
  type MatchScoreSummary,
} from "./storage.js";
export {
  generateBots,
  regenerateBotPickForMatch,
  leafForBotPick,
  type GeneratorOptions,
  type GenerationResult,
} from "./generator.js";
export {
  commitMatch,
  pendingMatches,
  type CommitMatchOptions,
  type CommitResult,
  type PendingMatch,
} from "./scheduler.js";
export {
  scoreMatch,
  type ScoreMatchOptions,
  type ScoreMatchSummary,
} from "./scorer.js";
export {
  registerNode,
  loadNodeCredentials,
  type RegisterOptions,
} from "./registration.js";
export {
  CentralClient,
  type CentralClientOptions,
  type RegistrationResponse,
} from "./central.js";
export { createServer, type ServerOptions, type CreatedServer } from "./server.js";
export {
  chalkStrategy,
  defaultChalkScore,
  defaultDarlingTeam,
  DARLING_TEAM_POOL,
} from "./strategy/chalk.js";
export type { Strategy, StrategyContext, PickDecision } from "./strategy/index.js";
export {
  sha256,
  hashLeaf,
  hashPair,
  merkleRoot,
  merkleProof,
  verifyProof,
  type MerkleProof,
  type MerkleProofStep,
} from "./merkle.js";
