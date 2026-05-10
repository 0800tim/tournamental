/**
 * JWT signing + verification.
 *
 * We use HS256 with a shared secret rather than RS256 because this
 * service mints AND verifies; downstream services can either share
 * the secret or hit /v1/auth/me to resolve the JWT. If/when other
 * services need to verify locally without a network hop, we'll switch
 * to asymmetric keys and publish a JWKS endpoint — see
 * docs/32-auth-and-privacy.md.
 *
 * Tokens carry:
 *   - sub: user_id
 *   - jti: session id (revocable via the `session` table)
 *   - iat / exp: standard
 *   - phone: E.164 (so the web client can show a masked phone without
 *            an extra round-trip; same trust boundary as the JWT itself).
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';

export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface SignedToken {
  jwt: string;
  jti: string;
  expiresAt: number; // unix seconds
}

export interface AuthClaims extends JWTPayload {
  sub: string;
  /**
   * E.164 phone, or empty string for users who authenticated via a
   * non-phone provider (e.g. Telegram Login Widget). Downstream services
   * that need a phone should resolve via /v1/auth/me rather than trusting
   * the claim is non-empty.
   */
  phone: string;
  jti: string;
}

function secretKeyBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionJwt(opts: {
  secret: string;
  userId: string;
  /** Empty string is allowed for non-phone providers (e.g. Telegram). */
  phone: string;
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
}): Promise<SignedToken> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttl;
  const issuer = opts.issuer ?? 'tournamental-auth';
  const audience = opts.audience ?? 'tournamental';

  const jwt = await new SignJWT({ phone: opts.phone, jti })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(opts.userId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setIssuer(issuer)
    .setAudience(audience)
    .setJti(jti)
    .sign(secretKeyBytes(opts.secret));

  return { jwt, jti, expiresAt };
}

export async function verifySessionJwt(opts: {
  secret: string;
  token: string;
  issuer?: string;
  audience?: string;
}): Promise<AuthClaims> {
  const issuer = opts.issuer ?? 'tournamental-auth';
  const audience = opts.audience ?? 'tournamental';
  const { payload } = await jwtVerify(opts.token, secretKeyBytes(opts.secret), {
    issuer,
    audience,
    algorithms: ['HS256'],
  });
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('jwt: missing sub');
  }
  const phone =
    typeof payload.phone === 'string' ? payload.phone : '';
  const jti =
    typeof payload.jti === 'string' ? payload.jti : '';
  if (!jti) {
    throw new Error('jwt: missing jti');
  }
  return { ...payload, sub: payload.sub, phone, jti } as AuthClaims;
}
