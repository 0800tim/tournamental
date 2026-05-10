/**
 * Adapter registry — single import surface for the rest of the service.
 *
 * The registry is keyed by `Platform` enum value. Adding a new adapter
 * means: drop a file in this directory, export an `Adapter`, register it
 * here, and add the platform tag to the `PlatformEnum` in src/types.ts.
 */

import type { Adapter, Platform } from '../../types.js';
import { discordAdapter } from './discord.js';
import { instagramReelsAdapter } from './instagram-reels.js';
import { redditAdapter } from './reddit.js';
import { telegramAdapter } from './telegram.js';
import { threadsAdapter } from './threads.js';
import { tiktokAdapter } from './tiktok.js';
import { whatsappAdapter } from './whatsapp.js';
import { xAdapter } from './x.js';
import { youtubeShortsAdapter } from './youtube-shorts.js';

export const ADAPTERS: Record<Platform, Adapter> = {
  tiktok: tiktokAdapter,
  'instagram-reels': instagramReelsAdapter,
  'youtube-shorts': youtubeShortsAdapter,
  x: xAdapter,
  threads: threadsAdapter,
  telegram: telegramAdapter,
  discord: discordAdapter,
  reddit: redditAdapter,
  whatsapp: whatsappAdapter,
};

export function getAdapter(platform: Platform): Adapter {
  return ADAPTERS[platform];
}

export const ALL_PLATFORMS: Platform[] = Object.keys(ADAPTERS) as Platform[];
