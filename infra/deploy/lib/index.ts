/**
 * Public surface of the @vtorn/cicd-tools deploy library.
 *
 * Per-app `.deploy/publish.ts` should import `publish` from here. The
 * `publish-all.ts` and `promote-to-prod.ts` orchestrators import the
 * change-detection helpers and the publish() function directly.
 */

export { publish, type PublishConfig, type PublishResult } from './publish.js';
export { rollback, type RollbackOptions, type RollbackResult } from './rollback.js';
export { slotPaths, buildCommand, smokeStartCommand, startCommand, type BuildKind, type SlotPaths, type SlotSpec } from './build-slots.js';
export { swap, rollbackSwap, type SwapResult, type SwapOptions, type SwapFs } from './swap.js';
export { smoke, type SmokeAssertion, type SmokeOptions, type SmokeResult } from './smoke.js';
export { reloadOrRestart, pm2Save, type Pm2Options, type Pm2Result } from './pm2.js';
export { cacheWarm, type WarmTarget, type WarmOptions, type WarmResult } from './cache-warm.js';
export { acquireLock, type AcquiredLock, type LockOptions } from './lock.js';
export { TimingsRecorder, appendTimings, type DeployTimings } from './timings.js';
export { detectChangedApps, type ChangedAppsOptions, type ChangedAppsResult } from './changed-apps.js';
