/**
 * Stateful key bootstrap: ensure an active Ed25519 keypair exists, decrypt
 * it on boot, and expose sign(message) for the rest of the service.
 */

import {
  decryptPrivkey,
  encryptPrivkey,
  generateKeypair,
  sign as edSign,
} from './keys.js';
import { bytesToHex } from './merkle.js';
import type { VStampDB } from './db.js';

export interface ActiveSigner {
  pubkeyHex: string;
  sign(message: Uint8Array): Uint8Array;
}

export function loadOrCreateSigner(db: VStampDB, passphrase: string): ActiveSigner {
  let row = db.getActiveKey();
  let privkey: Uint8Array;

  if (!row) {
    const kp = generateKeypair();
    const enc = encryptPrivkey(kp.privkey, passphrase);
    row = db.insertKey(bytesToHex(kp.pubkey), enc, Date.now());
    privkey = kp.privkey;
  } else {
    privkey = decryptPrivkey(row.privkey_encrypted, passphrase);
  }

  return {
    pubkeyHex: row.pubkey,
    sign(message) {
      return edSign(privkey, message);
    },
  };
}
