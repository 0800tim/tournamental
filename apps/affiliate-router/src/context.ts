import type { PartnerRegistry } from './partners.js';
import type { ClickStore } from './storage.js';

export interface AppContext {
  registry: PartnerRegistry;
  store: ClickStore;
  /** Salt for hashing user_id before persistence. */
  userHashSalt: string;
  /** Returns "now" in unix seconds. Injected so tests can freeze time. */
  now: () => number;
}
