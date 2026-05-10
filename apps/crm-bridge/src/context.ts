import type { GhlClient } from './lib/ghl-client.js';
import type { EventStore } from './store.js';

export interface AppContext {
  store: EventStore;
  ghl: GhlClient;
  /** Returns "now" in unix seconds. Injected so tests can freeze time. */
  now: () => number;
}
