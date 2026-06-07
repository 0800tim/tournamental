/**
 * @tournamental/bot-sdk
 *
 * Open Bot Arena SDK for the Tournamental FIFA WC 2026 prediction platform.
 * Apache 2.0. Source: https://github.com/0800tim/tournamental
 *
 * Quickstart:
 *   import { Bot } from "@tournamental/bot-sdk";
 *   const bot = new Bot({ apiKey: process.env.TOURNAMENTAL_API_KEY!, botId: "my-bot" });
 *   bot.pick("1", "home_win");
 *   await bot.flush();
 *
 * Full docs at https://play.tournamental.com/bots/sdk.
 */

export { Bot } from "./bot.js";
export type { BotOpts } from "./bot.js";
export { Swarm } from "./swarm.js";
export type { SwarmOpts, SwarmStats } from "./swarm.js";
export {
  postWithRetry,
  postWithRetryResult,
  DEFAULT_BASE_URL,
} from "./client.js";
export type { ClientOpts, PostResult } from "./client.js";
export { authHeaders } from "./auth.js";
export type { AuthHeaders } from "./auth.js";
export { submitBulk, submitBulkPicks, BULK_PATH } from "./bulk.js";
export type { SubmitBulkOpts } from "./bulk.js";
export type {
  Outcome,
  Stage,
  Pick,
  MatchSpec,
  BulkSubmission,
  BulkResponse,
  OddsSnapshot,
} from "./types.js";
