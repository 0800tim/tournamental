/**
 * Provider registry. Adapters slot in here so `routes/links.ts` can
 * resolve a `provider` string from the request body to its adapter.
 */

import { googleAdapter } from './google.js';
import { appleAdapter } from './apple.js';
import { telegramAdapter } from './telegram.js';
import { xAdapter } from './x.js';
import { discordAdapter } from './discord.js';
import { phoneAdapter } from './phone.js';
import type { ProviderAdapter, ProviderId } from './types.js';

export const providers: Record<ProviderId, ProviderAdapter> = {
  google: googleAdapter,
  apple: appleAdapter,
  telegram: telegramAdapter,
  x: xAdapter,
  discord: discordAdapter,
  phone: phoneAdapter,
};

export const PROVIDER_IDS: ProviderId[] = [
  'google',
  'apple',
  'telegram',
  'x',
  'discord',
  'phone',
];

export type { ProviderAdapter, ProviderId, ProviderProfile, StartLinkInput, StartLinkResult } from './types.js';
