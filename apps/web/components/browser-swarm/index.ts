export { default as BrowserSwarm } from "./BrowserSwarm";
export type { BrowserSwarmProps } from "./BrowserSwarm";
export type {
  BotPick,
  BotRecord,
  CommitLogRow,
  MatchSpec,
  NodeCredentials,
  Outcome,
  StrategyName,
  SupabaseConfig,
  SwarmProgress,
  SwarmStats,
} from "./types";
export { FederationClient } from "./federation";
export { merkleRoot, merkleProof, verifyProof } from "./merkle";
export { SUPABASE_SCHEMA_SQL, probeSupabase } from "./supabase";
// A11 Phase 2 polish surface:
export {
  resolveBotBracket,
  resolvedKnockoutSlots,
  type ResolvedBotBracket,
} from "./cascade";
export {
  buildDeviationTable,
  deviationSlotsForBotIndex,
  perturbedBracket,
  perturbedOutcome,
  singleDeviationCount,
  type DeviationSlot,
  type DeviationTable,
} from "./uniqueness";
export {
  ANCHOR_LABEL_BY_MODE,
  ANCHOR_TOURNAMENT_ID,
  ANCHOR_WEIGHT_BY_MODE,
  DEFAULT_ANCHOR_MODE,
  blendOutcome,
  captureAnchorSnapshot,
  flattenBracket,
  readUserBracketDraft,
  weightForMode,
  type AnchorMode,
  type AnchorSnapshot,
} from "./anchor";
