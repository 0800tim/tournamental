/**
 * X (Twitter) OAuth 2.0 adapter (stub).
 *
 * X / Twitter switched to OAuth 2.0 with PKCE in 2023. Real URL pattern:
 *   https://twitter.com/i/oauth2/authorize
 *     ?response_type=code
 *     &client_id=$TWITTER_OAUTH_CLIENT_ID
 *     &redirect_uri=$IDENTITY_PUBLIC_BASE_URL/v1/links/callback/x
 *     &scope=tweet.read%20users.read%20offline.access
 *     &state=$STATE
 *     &code_challenge=$PKCE_CHALLENGE
 *     &code_challenge_method=S256
 *
 * Required env (TODO):
 *   TWITTER_OAUTH_CLIENT_ID
 *   TWITTER_OAUTH_CLIENT_SECRET   (only "Confidential clients", optional w/ PKCE)
 *   TWITTER_OAUTH_KEY             (alias used in some Tim notebooks; same value)
 *   TWITTER_BEARER_TOKEN          (optional, for v2 lookups when caller is a bot)
 *
 * Profile pull: GET https://api.twitter.com/2/users/me?user.fields=created_at,
 *   public_metrics,profile_image_url,verified — note the v2 API is paid
 *   tier. Until X opens free identity reads we should treat this as a
 *   "premium humanness boost" not a default link.
 */

import type { ProviderAdapter, ProviderProfile, StartLinkInput, StartLinkResult } from './types.js';

export const xAdapter: ProviderAdapter = {
  id: 'x',
  displayName: 'X',
  startLink(input: StartLinkInput): StartLinkResult {
    const url = new URL('https://mock.identity.vtorn.local/x/authorize');
    url.searchParams.set('user_id', input.userId);
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return {
      authorizeUrl: url.toString(),
      expectedScopes: ['tweet.read', 'users.read', 'offline.access'],
    };
  },
  async resolveCallback(input): Promise<ProviderProfile> {
    // TODO: PKCE-exchange code, hit users/me, verify created_at.
    return {
      externalId: input.externalId,
      displayName: input.profile?.displayName,
      avatarUrl: input.profile?.avatarUrl,
      accountCreatedAt: input.profile?.accountCreatedAt,
      verified: input.profile?.verified,
      raw: input.profile?.raw,
    };
  },
};
