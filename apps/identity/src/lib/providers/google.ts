/**
 * Google OAuth 2.0 / OIDC adapter (stub).
 *
 * Real OAuth URL pattern:
 *   https://accounts.google.com/o/oauth2/v2/auth
 *     ?client_id=$GOOGLE_OAUTH_CLIENT_ID
 *     &redirect_uri=$IDENTITY_PUBLIC_BASE_URL/v1/links/callback/google
 *     &response_type=code
 *     &scope=openid%20email%20profile
 *     &state=$STATE
 *     &access_type=offline
 *     &prompt=consent
 *
 * Required env (TODO: wire in v0.2):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_OAUTH_REDIRECT_URI (defaults to $IDENTITY_PUBLIC_BASE_URL/v1/links/callback/google)
 *
 * Profile pull: GET https://www.googleapis.com/oauth2/v3/userinfo with the
 * access token. Map: sub -> externalId, name -> displayName, picture -> avatarUrl.
 */

import type { ProviderAdapter, ProviderProfile, StartLinkInput, StartLinkResult } from './types.js';

export const googleAdapter: ProviderAdapter = {
  id: 'google',
  displayName: 'Google',
  startLink(input: StartLinkInput): StartLinkResult {
    // MVP: mock URL only. Real impl will URL-encode client_id + scopes.
    const url = new URL('https://mock.identity.vtorn.local/google/authorize');
    url.searchParams.set('user_id', input.userId);
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return {
      authorizeUrl: url.toString(),
      expectedScopes: ['openid', 'email', 'profile'],
    };
  },
  async resolveCallback(input): Promise<ProviderProfile> {
    // TODO: exchange code via https://oauth2.googleapis.com/token then
    // GET https://www.googleapis.com/oauth2/v3/userinfo.
    return {
      externalId: input.externalId,
      displayName: input.profile?.displayName,
      email: input.profile?.email,
      avatarUrl: input.profile?.avatarUrl,
      accountCreatedAt: input.profile?.accountCreatedAt,
      raw: input.profile?.raw,
    };
  },
};
