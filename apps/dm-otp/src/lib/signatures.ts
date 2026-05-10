/**
 * Webhook signature verification helpers, one per platform.
 *
 * Every public webhook route MUST call the appropriate verifier
 * BEFORE dispatching the event. Constant-time comparison via
 * crypto.timingSafeEqual.
 */

import { createHmac, createVerify, timingSafeEqual } from 'node:crypto';

function safeEqualBuf(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Meta apps (Messenger, Instagram, Threads, WhatsApp): X-Hub-Signature-256: sha256=HEX. */
export function verifyMetaSignature(
  appSecret: string,
  rawBody: string | Buffer,
  headerValue: string | undefined,
): boolean {
  if (!headerValue || !headerValue.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody)
    .digest();
  const provided = Buffer.from(headerValue.slice('sha256='.length), 'hex');
  return safeEqualBuf(expected, provided);
}

/** Slack: V0 signature. https://api.slack.com/authentication/verifying-requests-from-slack */
export function verifySlackSignature(opts: {
  signingSecret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string;
  /** Now in unix seconds, for replay-window check. */
  now: number;
  /** Tolerance window in seconds. Default 300. */
  windowSeconds?: number;
}): boolean {
  const w = opts.windowSeconds ?? 300;
  if (!opts.timestamp || !opts.signature) return false;
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(opts.now - ts) > w) return false;
  if (!opts.signature.startsWith('v0=')) return false;
  const baseString = `v0:${opts.timestamp}:${opts.rawBody}`;
  const expected = `v0=${createHmac('sha256', opts.signingSecret).update(baseString).digest('hex')}`;
  return safeEqualBuf(Buffer.from(expected, 'utf8'), Buffer.from(opts.signature, 'utf8'));
}

/** LINE: X-Line-Signature is base64(HMAC-SHA256(channelSecret, body)). */
export function verifyLineSignature(
  channelSecret: string,
  rawBody: string,
  headerValue: string | undefined,
): boolean {
  if (!headerValue) return false;
  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  return safeEqualBuf(Buffer.from(expected, 'utf8'), Buffer.from(headerValue, 'utf8'));
}

/** Viber: X-Viber-Content-Signature is hex HMAC-SHA256(authToken, body). */
export function verifyViberSignature(
  authToken: string,
  rawBody: string,
  headerValue: string | undefined,
): boolean {
  if (!headerValue) return false;
  const expected = createHmac('sha256', authToken).update(rawBody).digest('hex');
  return safeEqualBuf(Buffer.from(expected, 'utf8'), Buffer.from(headerValue, 'utf8'));
}

/** X (Twitter) Account Activity API: x-twitter-webhooks-signature is sha256=BASE64. */
export function verifyXSignature(
  consumerSecret: string,
  rawBody: string,
  headerValue: string | undefined,
): boolean {
  if (!headerValue || !headerValue.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', consumerSecret).update(rawBody).digest('base64');
  return safeEqualBuf(
    Buffer.from(expected, 'utf8'),
    Buffer.from(headerValue.slice('sha256='.length), 'utf8'),
  );
}

/** Mailgun signature: HMAC-SHA256(apiKey, timestamp + token) === signature (hex). */
export function verifyMailgunSignature(opts: {
  signingKey: string;
  timestamp: string;
  token: string;
  signature: string;
  /** Now in unix seconds, for replay-window check. */
  now: number;
  windowSeconds?: number;
}): boolean {
  const w = opts.windowSeconds ?? 600;
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(opts.now - ts) > w) return false;
  const expected = createHmac('sha256', opts.signingKey)
    .update(`${opts.timestamp}${opts.token}`)
    .digest('hex');
  return safeEqualBuf(
    Buffer.from(expected, 'utf8'),
    Buffer.from(opts.signature, 'utf8'),
  );
}

/**
 * Discord: Ed25519 signature over (timestamp || body). The bot's public
 * key is given in the Developer Portal. We use Node's `crypto` Ed25519
 * KeyObject path to avoid pulling in tweetnacl.
 *
 * https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 */
export function verifyDiscordSignature(opts: {
  publicKeyHex: string;
  signatureHex: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
}): boolean {
  if (!opts.signatureHex || !opts.timestamp) return false;
  try {
    // crypto.verify with Ed25519 needs a public-key DER prefix; in modern
    // Node we can use createPublicKey({ key, format: 'jwk' })… but the
    // simpler stable path is verify('ed25519', data, key, signature) with
    // a SubjectPublicKeyInfo DER. Build that here.
    const rawKey = Buffer.from(opts.publicKeyHex, 'hex');
    if (rawKey.length !== 32) return false;
    // SPKI DER prefix for Ed25519 (RFC 8410).
    const prefix = Buffer.from('302a300506032b6570032100', 'hex');
    const der = Buffer.concat([prefix, rawKey]);
    const { createPublicKey, verify } = require('node:crypto') as typeof import('node:crypto');
    const key = createPublicKey({
      key: der,
      format: 'der',
      type: 'spki',
    });
    const sig = Buffer.from(opts.signatureHex, 'hex');
    const data = Buffer.from(opts.timestamp + opts.rawBody, 'utf8');
    return verify(null, data, key, sig);
  } catch {
    return false;
  }
}

/** Microsoft Bot Framework JWT: validated lazily by jwks-rsa in the route handler. */
// (Implementation lives in routes/webhooks/teams.ts.)

/** Generic shared-secret bearer header used by Reddit poller / Mastodon push (configurable). */
export function verifyBearer(
  expectedSecret: string,
  authHeader: string | undefined,
): boolean {
  if (!authHeader) return false;
  const expected = `Bearer ${expectedSecret}`;
  return safeEqualBuf(Buffer.from(expected, 'utf8'), Buffer.from(authHeader, 'utf8'));
}

/** Verify that a value is a non-empty string. */
export function nonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0;
}

void createVerify; // reserved for future asymmetric verifiers

// ---------------------------------------------------------------------------
// Legacy helpers retained from PR #90 for backward compatibility with any
// integrators still importing the original surface. These are functionally
// equivalent to the per-platform verifiers above; new code should prefer the
// platform-specific helpers (verifyMetaSignature, etc.).
// ---------------------------------------------------------------------------

/** Telegram: header `X-Telegram-Bot-Api-Secret-Token` is a literal shared secret. */
export function verifyTelegramSecret(opts: {
  header: string | undefined;
  expected: string;
}): boolean {
  if (!opts.expected) return false;
  if (typeof opts.header !== 'string' || !opts.header) return false;
  return timingSafeStringEqual(opts.header, opts.expected);
}

/** Compute hex HMAC-SHA256 of the raw body. */
export function hmacSha256Hex(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verify an `<scheme>=<hex>` style header (used by both Aiva WhatsApp and Meta).
 * The expected scheme is `sha256`.
 */
export function verifyHmacSha256Header(opts: {
  header: string | undefined;
  rawBody: string;
  secret: string;
}): boolean {
  if (!opts.secret) return false;
  if (typeof opts.header !== 'string' || !opts.header) return false;
  const idx = opts.header.indexOf('=');
  if (idx <= 0) return false;
  const scheme = opts.header.slice(0, idx).toLowerCase().trim();
  const provided = opts.header.slice(idx + 1).trim();
  if (scheme !== 'sha256') return false;
  if (!/^[0-9a-fA-F]+$/.test(provided)) return false;
  const expected = hmacSha256Hex(opts.secret, opts.rawBody);
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(provided.toLowerCase(), 'hex'),
    );
  } catch {
    return false;
  }
}
