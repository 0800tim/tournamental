/**
 * Boot-time per-adapter mode reporter.
 *
 * Surfaces which adapters are running real API calls vs which are still in
 * deterministic-stub fallback. The /healthz endpoint embeds this so an
 * operator can confirm at a glance which channels are live in any
 * environment.
 *
 * Each adapter file owns its own *Mode() function — this module just
 * collates them so the server doesn't import platform-specific guts.
 */

import type { Platform } from '../types.js';
import { discordAdapterMode } from './adapters/discord.js';
import { redditAdapterMode } from './adapters/reddit.js';
import { telegramAdapterMode } from './adapters/telegram.js';

export type AdapterMode = 'real' | 'stub';

export function adapterModes(): Record<Platform, AdapterMode> {
  return {
    // Real (or real-when-configured) adapters.
    discord: discordAdapterMode(),
    telegram: telegramAdapterMode(),
    reddit: redditAdapterMode(),
    whatsapp: whatsappEnvMode(),
    // Stub-only adapters (need App Review or paid API tier).
    tiktok: 'stub',
    'instagram-reels': 'stub',
    'youtube-shorts': 'stub',
    x: 'stub',
    threads: 'stub',
  };
}

/**
 * The whatsapp adapter doesn't expose a *Mode() helper of its own (it
 * predates this convention). It runs in real mode iff the env vars are
 * populated; mirror that logic here so /healthz tells the truth.
 */
function whatsappEnvMode(): AdapterMode {
  const baseUrl = process.env.AIVA_SMS_API_URL ?? process.env.AIVA_SMS_URL;
  const apiKey = process.env.AIVA_SMS_API_KEY;
  const sessionId = process.env.AIVA_WA_SESSION_ID;
  const groups = process.env.WHATSAPP_GROUP_IDS;
  if (!baseUrl || !apiKey || !sessionId || !groups) return 'stub';
  return 'real';
}
