// Geo-gated affiliate CTA pushes (Polymarket / pay-TV). Per docs/30 §
// geo-gating: NZ + AU are blocked for prediction-market affiliates,
// FR/UK conditional. Pay-TV affiliates are country-specific by design.
//
// This module enforces:
//   1. user_opted_in (notify_affiliate flag)
//   2. country not in blocked list
//   3. push policy (cap, quiet hours)

import type { Bot } from "grammy";
import type { Storage } from "../storage.js";
import { dayKey, shouldSendPush } from "../rate-limit.js";
import type { PushResult } from "./market-move.js";

export interface AffiliateCtaPush {
  user_id: string;
  kind: "polymarket-trade" | "paytv-stream";
  copy: string;             // pre-approved copy from doc 30
  url: string;              // full affiliate URL with ref param
  campaign_id: string;
}

export interface AffiliateConfig {
  // ISO-3166-1 alpha-2 codes for which polymarket-trade CTAs are blocked.
  blocked_countries_polymarket: ReadonlySet<string>;
  // Same for pay-TV. Per provider in production; here it's a global gate.
  blocked_countries_paytv: ReadonlySet<string>;
}

export const DEFAULT_AFFILIATE_CONFIG: AffiliateConfig = {
  blocked_countries_polymarket: new Set(["NZ", "AU"]),
  blocked_countries_paytv: new Set([]),
};

export async function sendAffiliateCtaPush(
  bot: Bot,
  storage: Storage,
  push: AffiliateCtaPush,
  config: AffiliateConfig = DEFAULT_AFFILIATE_CONFIG,
  now: Date = new Date(),
): Promise<PushResult> {
  const tgUser = storage.getUserByUserId(push.user_id);
  if (!tgUser) return { sent: false, reason: "no_telegram_link" };

  // Geo-gate first — cheaper than the rest, and enforces a regulatory rule.
  const country = (tgUser.country_code ?? "").toUpperCase();
  if (push.kind === "polymarket-trade") {
    if (!country) return { sent: false, reason: "geo_unknown" };
    if (config.blocked_countries_polymarket.has(country)) {
      return { sent: false, reason: "geo_blocked" };
    }
  } else if (push.kind === "paytv-stream") {
    if (country && config.blocked_countries_paytv.has(country)) {
      return { sent: false, reason: "geo_blocked" };
    }
  }

  // Affiliate pushes require explicit opt-in (doc 30: "Affiliate pushes are
  // separate and require explicit opt-in.")
  const decision = shouldSendPush({
    user: tgUser,
    category: "affiliate",
    now,
    in_match_window: false,
  });
  if (!decision.allow) return { sent: false, reason: decision.reason };

  const text = `${push.copy}\n${push.url}`;
  await bot.api.sendMessage(tgUser.chat_id, text, {
    link_preview_options: { is_disabled: false },
  });
  storage.recordPush(tgUser.chat_id, now.getTime(), dayKey(now, tgUser.tz));
  return { sent: true };
}
