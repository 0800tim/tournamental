/**
 * Phone (SMS / WhatsApp OTP) adapter (stub).
 *
 * Phone identity is owned by `apps/auth-sms` (Aiva SMS gateway, port :3330).
 * The identity service does not re-implement OTP — it delegates to that
 * service and persists the resulting (userId, phone-hash) link.
 *
 * "URL" pattern is internal — there's no OAuth handshake. The mock URL we
 * return is a deep-link into the auth-sms web flow; real impl will call:
 *   POST $AUTH_SMS_BASE_URL/v1/auth/request-otp
 *   POST $AUTH_SMS_BASE_URL/v1/auth/verify-otp
 *
 * Required env (TODO):
 *   AUTH_SMS_BASE_URL          (defaults to http://127.0.0.1:3330 in dev)
 *   AUTH_SMS_SERVICE_TOKEN     (shared secret for service-to-service calls)
 *
 * Profile: phone returned in E.164, salted SHA-256 hash stored.
 * `accountCreatedAt` is the original auth-sms session's first verify
 * timestamp — older verified phones contribute slightly more humanness.
 */

import type { ProviderAdapter, ProviderProfile, StartLinkInput, StartLinkResult } from './types.js';

export const phoneAdapter: ProviderAdapter = {
  id: 'phone',
  displayName: 'Phone (SMS / WhatsApp)',
  startLink(input: StartLinkInput): StartLinkResult {
    const url = new URL('https://mock.identity.vtorn.local/phone/authorize');
    url.searchParams.set('user_id', input.userId);
    url.searchParams.set('state', input.state);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return {
      authorizeUrl: url.toString(),
      expectedScopes: ['phone:verify'],
    };
  },
  async resolveCallback(input): Promise<ProviderProfile> {
    // TODO: confirm with auth-sms via service token; pull the verified-at
    // timestamp + (salted) phone hash; return externalId = phone hash.
    return {
      externalId: input.externalId,
      displayName: input.profile?.displayName,
      accountCreatedAt: input.profile?.accountCreatedAt,
      raw: input.profile?.raw,
    };
  },
};
