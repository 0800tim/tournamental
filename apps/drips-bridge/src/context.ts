import type { ContributorStore, DistributionStore } from './lib/contributors.js';
import type { DripsClient } from './lib/drips-client.js';

export interface AppContext {
  contributors: ContributorStore;
  distributions: DistributionStore;
  drips: DripsClient;
  /** Required header value for write routes — `x-drips-admin: <secret>`. */
  adminSecret: string;
  /** Returns "now" as ISO string. Injected so tests can freeze time. */
  nowIso: () => string;
}
