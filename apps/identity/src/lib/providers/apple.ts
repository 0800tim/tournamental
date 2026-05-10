/**
 * Sign in with Apple adapter (stub).
 *
 * Real OAuth URL pattern (form_post response_mode is required by Apple):
 *   https://appleid.apple.com/auth/authorize
 *     ?client_id=$APPLE_SERVICES_ID            (e.g. com.vtorn.signin)
 *     &redirect_uri=$IDENTITY_PUBLIC_BASE_URL/v1/links/callback/apple
 *     &response_type=code%20id_token
 *     &response_mode=form_post
 *     &scope=name%20email
 *     &state=$STATE
 *
 * Apple requires a JWT-signed client_secret per session. Required env (TODO):
 *   APPLE_TEAM_ID            (10-char Apple developer team)
 *   APPLE_SERVICES_ID        (Services ID, doubles as client_id)
 *   APPLE_KEY_ID             (key id of the .p8 private key)
 *   APPLE_PRIVATE_KEY        (PEM-encoded p8 contents OR a path to the .p8)
 *   APPLE_REDIRECT_URI
 *
 * Profile: Apple disclose name only on FIRST consent (form-post body), and
 * email is often a relay (privaterelay.appleid.com). Cache name on link.
 */

import type { ProviderAdapter, ProviderProfile, StartLinkInput, StartLinkResult } from './types.js';

export const appleAdapter: ProviderAdapter = {
  id: 'apple',
  displayName: 'Apple',
  startLink(input: StartLinkInput): StartLinkResult {
    const url = new URL('https://mock.identity.vtorn.local/apple/authorize');
    url.searchParams.set('user_id', input.userId);
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return {
      authorizeUrl: url.toString(),
      expectedScopes: ['name', 'email'],
    };
  },
  async resolveCallback(input): Promise<ProviderProfile> {
    // TODO: validate id_token (RS256 against Apple JWKS) and persist
    // first-consent name from the form_post payload.
    return {
      externalId: input.externalId,
      displayName: input.profile?.displayName,
      email: input.profile?.email,
      raw: input.profile?.raw,
    };
  },
};
