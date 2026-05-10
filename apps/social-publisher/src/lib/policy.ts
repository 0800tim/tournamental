/**
 * Policy router — picks which platforms a `ClipReady` event fans out to.
 *
 * The mapping lives in `config/social-policy.json` and is keyed by
 * `eventType` with optional per-tournament overrides under `tournaments`.
 *
 * Lookup order:
 *   1. tournaments[tournamentId][eventType]
 *   2. default[eventType]
 *   3. [] (no fan-out)
 *
 * The router never mutates the policy file. Callers can pass a different
 * policy via `loadPolicy()` to make tests deterministic.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALL_PLATFORMS } from './adapters/index.js';
import type { EventType, Platform } from '../types.js';

export interface SocialPolicy {
  default: Partial<Record<EventType, Platform[]>>;
  tournaments?: Record<string, Partial<Record<EventType, Platform[]>>>;
}

function defaultPolicyPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/lib/policy.ts → ../../config/social-policy.json
  return join(here, '..', '..', 'config', 'social-policy.json');
}

/**
 * Load the policy from disk. Strips `$comment` keys that the JSON file uses
 * for human notes (JSON has no comment syntax, so they're stored as data).
 */
export function loadPolicy(path?: string): SocialPolicy {
  const raw = readFileSync(path ?? defaultPolicyPath(), 'utf8');
  const parsed = JSON.parse(raw) as SocialPolicy & { $comment?: string };
  return stripComments(parsed) as SocialPolicy;
}

/**
 * Pick the fan-out target list for a given (tournamentId, eventType).
 * Filters out any platform we don't have an adapter for, so an out-of-date
 * policy file never crashes the publisher.
 */
export function platformsFor(
  policy: SocialPolicy,
  tournamentId: string,
  eventType: EventType,
): Platform[] {
  const tour = policy.tournaments?.[tournamentId]?.[eventType];
  const fallback = policy.default[eventType] ?? [];
  const chosen = tour ?? fallback;
  return chosen.filter((p): p is Platform => ALL_PLATFORMS.includes(p as Platform));
}

function stripComments<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripComments(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === '$comment') continue;
      out[k] = stripComments(v);
    }
    return out as T;
  }
  return value;
}
