/*
 * Copyright 2026 Tournamental contributors.
 * Licensed under the Apache Licence, Version 2.0 (the "Licence").
 * You may not use this file except in compliance with the Licence.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ---
 *
 * Editorial preset family — gold + charcoal + Fraunces. Each preset
 * exports a typed `render(args)` returning the PNG bytes for both the
 * landscape (1200x630) and the story (1080x1920) sizes.
 *
 * Choose preset by the moment it fires:
 *
 *   - `predictionPick`       -> user saves a single high-impact pick.
 *   - `leaderboardRankUp`    -> user climbs a leaderboard position.
 *   - `perfectWeek`          -> user clears a 7-day correct-pick streak.
 *   - `syndicateInvite`      -> generic pool-share card (mirrors the
 *                                /api/og/syndicate route).
 */

import * as predictionPickModule from "./prediction-pick.js";
import * as leaderboardRankUpModule from "./leaderboard-rank-up.js";
import * as perfectWeekModule from "./perfect-week.js";
import * as syndicateInviteModule from "./syndicate-invite.js";

export const predictionPick = {
  render: predictionPickModule.render,
};
export const leaderboardRankUp = {
  render: leaderboardRankUpModule.render,
};
export const perfectWeek = {
  render: perfectWeekModule.render,
};
export const syndicateInvite = {
  render: syndicateInviteModule.render,
};

export type { PredictionPickArgs } from "./prediction-pick.js";
export type { LeaderboardRankUpArgs } from "./leaderboard-rank-up.js";
export type { PerfectWeekArgs } from "./perfect-week.js";
export type { SyndicateInviteArgs } from "./syndicate-invite.js";
