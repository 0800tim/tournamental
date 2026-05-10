/**
 * Humanness Score (0-100) — v0.1 MVP.
 *
 * Implements a simplified version of the algorithm in
 * docs/20-identity-humanness-bots.md. The intent of v0.1 is
 *   (a) prove the contract (factor list with weights, deterministic output),
 *   (b) give the admin customer-360 page a meaningful score today,
 *   (c) leave the weights tunable in one place.
 *
 * Friend reciprocity (the "killer signal" in doc 20) is intentionally
 * left as a v0.3 TODO — it requires the friendship graph DB which doesn't
 * exist yet. We surface a `friend_reciprocity` factor with weight 0 and
 * value 0 so the breakdown UI can render a placeholder row today.
 *
 * ---------------------------------------------------------------------------
 * FACTOR WEIGHT TABLE
 * ---------------------------------------------------------------------------
 *
 * | factor id              | weight | rationale                                 |
 * |------------------------|--------|-------------------------------------------|
 * | base                   |    +5  | every authenticated user gets a small     |
 * |                        |        | floor; raised from doc 20's +2 because    |
 * |                        |        | v0.1 has no anonymous tier.               |
 * | provider_stack         |   +50  | sum of per-provider weights, capped 50.   |
 * | provider_diversity     |   +10  | 3+ distinct provider categories            |
 * |                        |        | (oauth/social/phone) — anti-stacking same  |
 * |                        |        | provider class.                            |
 * | link_freshness         |    +5  | mean recency of links (last_seen < 30d).   |
 * | telegram_premium       |    +3  | small bonus per doc 20 (Telegram premium  |
 * |                        |        | flag = paid Telegram, hard for bots).     |
 * | x_verified             |    +2  | X blue-tick adds a tiny bonus.            |
 * | behaviour_consistency  |   +10  | non-burst pick cadence + variable delays. |
 * | device_fingerprint     |    +5  | stable device id across sessions.         |
 * | captcha_pass_rate      |    +5  | recent captcha success rate.              |
 * | friend_reciprocity     |    +0  | v0.3 — placeholder, not contributing yet. |
 * | bot_signals            |   -25  | API-only, burst patterns, IP reuse, etc.  |
 *
 * SUM (theoretical max) = +95 + bot_signals (negative).
 * Score is clamped to [0, 100].
 *
 * Per-provider weights (used inside `provider_stack`, totals capped at 50):
 *
 *   google       15
 *   apple        15
 *   telegram     10
 *   discord       8
 *   x             8
 *   phone        12
 *
 * These mirror doc 20 with WhatsApp / Facebook / LinkedIn / GitHub deferred
 * to v0.2+. Adjust here, not at call sites — the table is the single source.
 */

import type { IdentityLinkRecord, HumannessFactor, HumannessSnapshot } from './storage.js';
import type { ProviderId } from './providers/index.js';

export const PROVIDER_WEIGHTS: Record<ProviderId, number> = {
  google: 15,
  apple: 15,
  telegram: 10,
  discord: 8,
  x: 8,
  phone: 12,
};

export const FACTOR_WEIGHTS = {
  base: 5,
  provider_stack: 50,
  provider_diversity: 10,
  link_freshness: 5,
  telegram_premium: 3,
  x_verified: 2,
  behaviour_consistency: 10,
  device_fingerprint: 5,
  captcha_pass_rate: 5,
  friend_reciprocity: 0,
  bot_signals: -25,
} as const;

const FRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface BehaviouralSignals {
  /**
   * 0-1: how consistent the user's prediction cadence is with human
   * patterns (variable, daytime-clustered). 1 = very human, 0 = bot-like.
   */
  cadenceConsistency?: number;
  /** 0-1: stability of the device fingerprint across sessions. */
  deviceStability?: number;
  /** 0-1: recent captcha pass rate. */
  captchaPassRate?: number;
  /**
   * 0-1: confidence this account is automated. Drives the negative
   * `bot_signals` factor (1 = clearly a bot, 0 = clearly not).
   */
  botLikelihood?: number;
  /** Whether at least one Telegram link reports premium. */
  telegramPremium?: boolean;
  /** Whether at least one X link reports verified. */
  xVerified?: boolean;
}

export interface ScoreInput {
  userId: string;
  links: IdentityLinkRecord[];
  signals?: BehaviouralSignals;
  /** Test seam — pass through to keep scoring deterministic. */
  now?: number;
}

export function computeHumanness(input: ScoreInput): HumannessSnapshot {
  const now = input.now ?? Date.now();
  const links = input.links;
  const signals = input.signals ?? {};
  const factors: HumannessFactor[] = [];

  // 1. base
  factors.push({
    id: 'base',
    weight: FACTOR_WEIGHTS.base,
    value: links.length > 0 ? 1 : 0,
    contribution: links.length > 0 ? FACTOR_WEIGHTS.base : 0,
    note: 'authenticated user floor',
  });

  // 2. provider_stack — sum of per-provider weights, capped.
  const distinct = new Set(links.map((l) => l.provider));
  let stackRaw = 0;
  for (const id of distinct) {
    stackRaw += PROVIDER_WEIGHTS[id] ?? 0;
  }
  const stackCapped = Math.min(stackRaw, FACTOR_WEIGHTS.provider_stack);
  factors.push({
    id: 'provider_stack',
    weight: FACTOR_WEIGHTS.provider_stack,
    value: stackRaw / FACTOR_WEIGHTS.provider_stack,
    contribution: stackCapped,
    note: `${distinct.size} providers linked`,
  });

  // 3. provider_diversity — small bonus when 3+ distinct providers cover
  //    different categories (oauth: google/apple, social: telegram/x/discord,
  //    phone: phone). Encourages stacking *kinds* not duplicates.
  const categories = new Set<string>();
  for (const id of distinct) {
    if (id === 'google' || id === 'apple') categories.add('oauth');
    else if (id === 'telegram' || id === 'x' || id === 'discord') categories.add('social');
    else if (id === 'phone') categories.add('phone');
  }
  const diversity = categories.size >= 3 ? 1 : categories.size >= 2 ? 0.5 : 0;
  factors.push({
    id: 'provider_diversity',
    weight: FACTOR_WEIGHTS.provider_diversity,
    value: diversity,
    contribution: diversity * FACTOR_WEIGHTS.provider_diversity,
    note: `${categories.size} provider categories`,
  });

  // 4. link_freshness — mean recency.
  let freshness = 0;
  if (links.length > 0) {
    const recencies = links.map((l) => {
      const age = Math.max(0, now - (l.lastSeenAt ?? l.linkedAt));
      // 0 if older than 30 days, 1 if just-now-fresh.
      return Math.max(0, 1 - age / FRESH_WINDOW_MS);
    });
    freshness = recencies.reduce((a, b) => a + b, 0) / recencies.length;
  }
  factors.push({
    id: 'link_freshness',
    weight: FACTOR_WEIGHTS.link_freshness,
    value: freshness,
    contribution: freshness * FACTOR_WEIGHTS.link_freshness,
    note: 'mean link freshness over 30d window',
  });

  // 5. telegram_premium
  const tgPremium =
    signals.telegramPremium ??
    links.some((l) => l.provider === 'telegram' && l.profile?.telegramPremium);
  factors.push({
    id: 'telegram_premium',
    weight: FACTOR_WEIGHTS.telegram_premium,
    value: tgPremium ? 1 : 0,
    contribution: tgPremium ? FACTOR_WEIGHTS.telegram_premium : 0,
  });

  // 6. x_verified
  const xVerified =
    signals.xVerified ?? links.some((l) => l.provider === 'x' && l.profile?.verified);
  factors.push({
    id: 'x_verified',
    weight: FACTOR_WEIGHTS.x_verified,
    value: xVerified ? 1 : 0,
    contribution: xVerified ? FACTOR_WEIGHTS.x_verified : 0,
  });

  // 7. behaviour_consistency
  const cadence = clamp01(signals.cadenceConsistency ?? 0);
  factors.push({
    id: 'behaviour_consistency',
    weight: FACTOR_WEIGHTS.behaviour_consistency,
    value: cadence,
    contribution: cadence * FACTOR_WEIGHTS.behaviour_consistency,
    note: 'pick cadence vs bot burst patterns',
  });

  // 8. device_fingerprint
  const dev = clamp01(signals.deviceStability ?? 0);
  factors.push({
    id: 'device_fingerprint',
    weight: FACTOR_WEIGHTS.device_fingerprint,
    value: dev,
    contribution: dev * FACTOR_WEIGHTS.device_fingerprint,
    note: 'fingerprint stability across sessions',
  });

  // 9. captcha_pass_rate
  const cap = clamp01(signals.captchaPassRate ?? 0);
  factors.push({
    id: 'captcha_pass_rate',
    weight: FACTOR_WEIGHTS.captcha_pass_rate,
    value: cap,
    contribution: cap * FACTOR_WEIGHTS.captcha_pass_rate,
  });

  // 10. friend_reciprocity (placeholder, see TODO above).
  factors.push({
    id: 'friend_reciprocity',
    weight: FACTOR_WEIGHTS.friend_reciprocity,
    value: 0,
    contribution: 0,
    note: 'v0.3 — friendship graph DB not yet online',
  });

  // 11. bot_signals (negative).
  const bot = clamp01(signals.botLikelihood ?? 0);
  factors.push({
    id: 'bot_signals',
    weight: FACTOR_WEIGHTS.bot_signals,
    value: bot,
    contribution: bot * FACTOR_WEIGHTS.bot_signals,
    note: 'API-only / burst / IP reuse',
  });

  const raw = factors.reduce((a, f) => a + f.contribution, 0);
  const score = Math.round(clamp(raw, 0, 100));

  return {
    userId: input.userId,
    score,
    factors,
    computedAt: now,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}
