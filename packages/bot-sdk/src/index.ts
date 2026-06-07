/**
 * @tournamental/bot-sdk
 *
 * Open Bot Arena SDK for the Tournamental FIFA WC 2026 prediction platform.
 * Apache 2.0. Source: https://github.com/0800tim/tournamental
 *
 * Quickstart:
 *   import { Bot, getOdds } from "@tournamental/bot-sdk";
 *
 *   const bot = new Bot({
 *     apiKey: process.env.TOURNAMENTAL_API_KEY!,
 *     botId: "my-first-bot",
 *   });
 *
 *   await bot.connect();
 *   for (const m of bot.matches()) {
 *     const odds = await getOdds(m.id);
 *     await bot.pick(m.id, odds.favourite);
 *   }
 *   await bot.flush();
 *
 * Full docs at https://play.tournamental.com/bots/sdk.
 */

export { Bot } from "./bot.js";
export type { BotOpts, ConnectResult } from "./bot.js";
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
export {
  getOdds,
  getInjuries,
  getWeather,
  toOddsSnapshot,
} from "./feeds.js";
export type {
  Favourite,
  FeedOpts,
  OddsResult,
  InjuryItem,
  InjuriesResult,
  WeatherResult,
} from "./feeds.js";
export type {
  Outcome,
  Stage,
  Pick,
  MatchSpec,
  BulkSubmission,
  BulkResponse,
  OddsSnapshot,
} from "./types.js";
