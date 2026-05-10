/**
 * Fan-out orchestrator. Given a `ClipReady` event, looks up the policy,
 * calls every platform adapter in parallel, and appends a `PostRecord`
 * for each (success or failure) to the audit log.
 *
 * Adapter calls are isolated: one platform failing never aborts the others.
 * This is deliberate — fan-out is best-effort, and partial success is
 * better than no success.
 */

import type { Logger } from 'pino';

import { getAdapter } from './adapters/index.js';
import type { AuditLog } from './audit-log.js';
import { platformsFor, type SocialPolicy } from './policy.js';
import type { ClipReady, Platform, PostRecord, PublishContext } from '../types.js';

export interface PublishOutcome {
  platform: Platform;
  status: 'published' | 'failed';
  externalId?: string;
  url?: string;
  error?: string;
}

export interface PublishOptions {
  policy: SocialPolicy;
  log: AuditLog;
  ctx?: PublishContext;
  logger?: Logger;
  /** Inject a clock for deterministic test timestamps. */
  now?: () => number;
}

export async function publishClip(
  clip: ClipReady,
  opts: PublishOptions,
): Promise<PublishOutcome[]> {
  const platforms = platformsFor(opts.policy, clip.tournamentId, clip.eventType);
  const ctx = opts.ctx ?? {};
  const now = opts.now ?? (() => Date.now());

  const results = await Promise.all(
    platforms.map(async (platform): Promise<PublishOutcome> => {
      const adapter = getAdapter(platform);
      try {
        const { externalId, url } = await adapter.publish(clip, ctx);
        const record: PostRecord = {
          ts: now(),
          platform,
          externalId,
          url,
          clipId: clip.clipId,
          eventType: clip.eventType,
          status: 'published',
          tournamentId: clip.tournamentId,
          matchId: clip.matchId,
        };
        await opts.log.append(record);
        opts.logger?.info(
          { platform, clipId: clip.clipId, externalId },
          'social post published',
        );
        return { platform, status: 'published', externalId, url };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const record: PostRecord = {
          ts: now(),
          platform,
          externalId: '',
          url: '',
          clipId: clip.clipId,
          eventType: clip.eventType,
          status: 'failed',
          tournamentId: clip.tournamentId,
          matchId: clip.matchId,
          error: message,
        };
        await opts.log.append(record).catch(() => {
          /* swallow audit-log failure; never escalate. */
        });
        opts.logger?.warn(
          { platform, clipId: clip.clipId, err: message },
          'social post failed',
        );
        return { platform, status: 'failed', error: message };
      }
    }),
  );
  return results;
}
