/**
 * Ed25519 signing keys for VStamp roots.
 *
 * - Keypair generated via @noble/curves (audited, zero-dep, browser-safe).
 * - Privkey is encrypted at rest with AES-256-GCM (node:crypto built-in).
 * - The encryption key is derived from VSTAMP_KEY_PASSPHRASE via scrypt.
 *
 * Storage format (base64 of):
 *   salt(16) || nonce(12) || ciphertext(32) || tag(16)
 *
 * The salt is per-key so even an attacker who learns the passphrase needs to
 * do per-key scrypt work to decrypt them all. scrypt parameters favour
 * boot-time decryption (~50ms) over interactive use; bump N if deploying to
 * a faster machine.
 *
 * On boot we look for the active key (retired_at IS NULL); if none exists we
 * mint one. Rotation is a future concern (PR welcome): retire the old key,
 * mint a new one, and old roots verify against their stored pubkey.
 */

import { ed25519 } from '@noble/curves/ed25519';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { bytesToHex, hexToBytes } from './merkle.js';

export interface Keypair {
  privkey: Uint8Array; // 32 bytes
  pubkey: Uint8Array; // 32 bytes
}

const SALT_LEN = 16;
const NONCE_LEN = 12;
const KEY_LEN = 32;
const TAG_LEN = 16;
const SCRYPT_N = 1 << 14; // 16384
const SCRYPT_r = 8;
const SCRYPT_p = 1;

export function generateKeypair(): Keypair {
  const privkey = ed25519.utils.randomPrivateKey();
  const pubkey = ed25519.getPublicKey(privkey);
  return { privkey, pubkey };
}

export function sign(privkey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, privkey);
}

export function verifySignature(
  pubkey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, pubkey);
  } catch {
    return false;
  }
}

export function signHex(privkey: Uint8Array, message: Uint8Array): string {
  return bytesToHex(sign(privkey, message));
}

export function verifyHex(pubkeyHex: string, message: Uint8Array, signatureHex: string): boolean {
  try {
    return verifySignature(hexToBytes(pubkeyHex), message, hexToBytes(signatureHex));
  } catch {
    return false;
  }
}

function deriveKEK(passphrase: string, salt: Uint8Array): Uint8Array {
  if (!passphrase) {
    throw new Error('VSTAMP_KEY_PASSPHRASE is required to derive the key-encryption key');
  }
  const buf = scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: 64 * 1024 * 1024,
  });
  return new Uint8Array(buf);
}

export function encryptPrivkey(privkey: Uint8Array, passphrase: string): string {
  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const kek = deriveKEK(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', kek, nonce);
  const ct = Buffer.concat([cipher.update(privkey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, nonce, ct, tag]).toString('base64');
}

export function decryptPrivkey(blob: string, passphrase: string): Uint8Array {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length !== SALT_LEN + NONCE_LEN + KEY_LEN + TAG_LEN) {
    throw new Error(`encrypted privkey blob has wrong length: ${buf.length}`);
  }
  const salt = buf.subarray(0, SALT_LEN);
  const nonce = buf.subarray(SALT_LEN, SALT_LEN + NONCE_LEN);
  const ct = buf.subarray(SALT_LEN + NONCE_LEN, SALT_LEN + NONCE_LEN + KEY_LEN);
  const tag = buf.subarray(SALT_LEN + NONCE_LEN + KEY_LEN);
  const kek = deriveKEK(passphrase, new Uint8Array(salt));
  const decipher = createDecipheriv('aes-256-gcm', kek, nonce);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return new Uint8Array(pt);
}

/**
 * Constant-time comparison of two strings, used for admin-token checks.
 * Returns false if either string is empty (so a missing config rejects).
 */
export function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
