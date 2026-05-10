/**
 * JWT signer for DM-OTP sessions.
 *
 * Same shape as apps/auth-sms/src/jwt.ts so the api gateway can verify
 * either kind of token with the same secret. The only difference: the
 * `phone` claim is optional here (DM-OTP doesn't always know a phone),
 * and we add `channel` + `externalId` so downstream services can audit
 * how a session was minted.
 *
 * TODO(packages/auth-shared): lift the signer into a shared package once
 * a third consumer appears. Until then, we keep the surface in sync by
 * convention.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';

export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export type DmChannel = 'telegram' | 'whatsapp' | 'messenger' | 'instagram';

export interface SignedToken {
  jwt: string;
  jti: string;
  expiresAt: number; // unix seconds
}

export interface DmAuthClaims extends JWTPayload {
  sub: string;
  jti: string;
  channel: DmChannel;
  externalId: string;
  phone?: string;
}

function secretKeyBytes(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSessionJwt(opts: {
  secret: string;
  userId: string;
  channel: DmChannel;
  externalId: string;
  phone?: string;
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
}): Promise<SignedToken> {
  const ttl = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttl;
  const issuer = opts.issuer ?? 'vtourn-auth';
  const audience = opts.audience ?? 'vtourn';

  const payload: Record<string, unknown> = {
    jti,
    channel: opts.channel,
    externalId: opts.externalId,
  };
  if (opts.phone) payload.phone = opts.phone;

  const jwt = await new SignJWT(payload)
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
}): Promise<DmAuthClaims> {
  const issuer = opts.issuer ?? 'vtourn-auth';
  const audience = opts.audience ?? 'vtourn';
  const { payload } = await jwtVerify(opts.token, secretKeyBytes(opts.secret), {
    issuer,
    audience,
    algorithms: ['HS256'],
  });
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('jwt: missing sub');
  }
  const jti = typeof payload.jti === 'string' ? payload.jti : '';
  const channel =
    typeof payload.channel === 'string' ? (payload.channel as DmChannel) : 'telegram';
  const externalId =
    typeof payload.externalId === 'string' ? payload.externalId : '';
  if (!jti || !externalId) {
    throw new Error('jwt: missing jti or externalId');
  }
  return {
    ...payload,
    sub: payload.sub,
    jti,
    channel,
    externalId,
  } as DmAuthClaims;
}
