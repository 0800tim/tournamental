/**
 * Discord OAuth 2.0 adapter (stub).
 *
 * Real URL pattern:
 *   https://discord.com/api/oauth2/authorize
 *     ?client_id=$DISCORD_OAUTH_CLIENT_ID
 *     &redirect_uri=$IDENTITY_PUBLIC_BASE_URL/v1/links/callback/discord
 *     &response_type=code
 *     &scope=identify%20email%20guilds
 *     &state=$STATE
 *
 * Required env (TODO):
 *   DISCORD_OAUTH_CLIENT_ID
 *   DISCORD_OAUTH_CLIENT_SECRET
 *
 * Profile: GET https://discord.com/api/v10/users/@me — id, username,
 * global_name, avatar (CDN-URL composed: cdn.discordapp.com/avatars/$id/$hash.png),
 * email, verified, premium_type. Mutual-server overlap = humanness signal:
 * GET /users/@me/guilds (requires `guilds` scope).
 */

import type { ProviderAdapter, ProviderProfile, StartLinkInput, StartLinkResult } from './types.js';

export const discordAdapter: ProviderAdapter = {
  id: 'discord',
  displayName: 'Discord',
  startLink(input: StartLinkInput): StartLinkResult {
    const url = new URL('https://mock.identity.vtorn.local/discord/authorize');
    url.searchParams.set('user_id', input.userId);
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return {
      authorizeUrl: url.toString(),
      expectedScopes: ['identify', 'email', 'guilds'],
    };
  },
  async resolveCallback(input): Promise<ProviderProfile> {
    // TODO: token exchange + /users/@me + /users/@me/guilds.
    return {
      externalId: input.externalId,
      displayName: input.profile?.displayName,
      email: input.profile?.email,
      avatarUrl: input.profile?.avatarUrl,
      raw: input.profile?.raw,
    };
  },
};
