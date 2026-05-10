/**
 * Telegram identity adapter (stub).
 *
 * Telegram identity is established via the bot (see apps/tournament-bot
 * + doc 13). Linking flow uses the **Telegram Login Widget** for web, or
 * the bot deep-link `tg://resolve?domain=$TELEGRAM_BOT_NAME&start=link_$STATE`.
 *
 * Real "URL" pattern (login widget callback, no OAuth dance — Telegram
 * signs a payload with the bot token's SHA-256 and the client posts it
 * back to us):
 *   https://oauth.telegram.org/auth
 *     ?bot_id=$TELEGRAM_BOT_ID
 *     &origin=$IDENTITY_PUBLIC_BASE_URL
 *     &request_access=write
 *     &return_to=$IDENTITY_PUBLIC_BASE_URL/v1/links/callback/telegram?state=$STATE
 *
 * Required env (TODO: wire in v0.2):
 *   TELEGRAM_BOT_TOKEN     (bot HTTP API token; used to verify the widget signature)
 *   TELEGRAM_BOT_ID        (numeric, derivable from token's prefix)
 *   TELEGRAM_BOT_NAME      (e.g. "vtorn_bot")
 *
 * Profile: Telegram returns id, first_name, last_name, username, photo_url,
 * auth_date, hash. Verify hash = HMAC_SHA256(data_check_string, bot_token).
 * `is_premium` is exposed only via the bot getMe / getChat APIs, not the
 * widget — we pull it from the bot session record after first link.
 */

import type { ProviderAdapter, ProviderProfile, StartLinkInput, StartLinkResult } from './types.js';

export const telegramAdapter: ProviderAdapter = {
  id: 'telegram',
  displayName: 'Telegram',
  startLink(input: StartLinkInput): StartLinkResult {
    const url = new URL('https://mock.identity.vtorn.local/telegram/authorize');
    url.searchParams.set('user_id', input.userId);
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return {
      authorizeUrl: url.toString(),
      expectedScopes: ['login_widget'],
    };
  },
  async resolveCallback(input): Promise<ProviderProfile> {
    // TODO: HMAC-verify Telegram payload against TELEGRAM_BOT_TOKEN.
    return {
      externalId: input.externalId,
      displayName: input.profile?.displayName,
      avatarUrl: input.profile?.avatarUrl,
      telegramPremium: input.profile?.telegramPremium,
      raw: input.profile?.raw,
    };
  },
};
