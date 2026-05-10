import type { Storage } from './lib/storage.js';

export interface IdentityContext {
  storage: Storage;
  config: {
    publicBaseUrl: string;
    adminToken: string;
  };
  now: () => number;
  log: {
    info: (obj: object | string, msg?: string) => void;
    warn: (obj: object | string, msg?: string) => void;
    error: (obj: object | string, msg?: string) => void;
  };
}
