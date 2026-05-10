/**
 * JWT signing for DM-OTP sessions.
 *
 * HS256, same scheme as auth-sms. Tokens carry:
 *   - sub: user_id
 *   - jti: session id
 *   - channel: the DM channel that authenticated the user
 *   - externalId: the platform-specific id (masked in logs)
 *   - iat / exp: standard
 *
 * If/when the API gateway wants to verify locally without a network
 * hop, we'll switch to RS256 + a JWKS endpoint. See
 * docs/32-auth-and-privacy.md.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';

export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface SignedSession {
  jwt: string;
  jti: string;
  expiresAt: number; // unix seconds
}

export interface DmOtpClaims extends JWTPayload {
  sub: string;
  channel: string;
  externalId: string;
  jti: string;
}

function secretKeyBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSession(opts: {
  secret: string;
  userId: string;
  channel: string;
  externalId: string;
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
}): Promise<SignedSession> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttl;
  const issuer = opts.issuer ?? 'vtourn-dm-otp';
  const audience = opts.audience ?? 'vtourn';

  const jwt = await new SignJWT({
    channel: opts.channel,
    externalId: opts.externalId,
    jti,
  })
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

export async function verifySession(opts: {
  secret: string;
  token: string;
  issuer?: string;
  audience?: string;
}): Promise<DmOtpClaims> {
  const issuer = opts.issuer ?? 'vtourn-dm-otp';
  const audience = opts.audience ?? 'vtourn';
  const { payload } = await jwtVerify(
    opts.token,
    secretKeyBytes(opts.secret),
    { issuer, audience, algorithms: ['HS256'] },
  );
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('jwt: missing sub');
  }
  const channel =
    typeof payload.channel === 'string' ? payload.channel : '';
  const externalId =
    typeof payload.externalId === 'string' ? payload.externalId : '';
  const jti = typeof payload.jti === 'string' ? payload.jti : '';
  if (!channel || !externalId || !jti) {
    throw new Error('jwt: missing claims');
  }
  return { ...payload, sub: payload.sub, channel, externalId, jti } as DmOtpClaims;
}
