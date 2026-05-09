import type { VStampDB } from './lib/db.js';
import type { ActiveSigner } from './lib/key-store.js';

export interface Context {
  db: VStampDB;
  signer: ActiveSigner;
  adminToken: string;
}
