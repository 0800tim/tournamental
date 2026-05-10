/**
 * Customer aggregate — replays a user's stored events to build the GHL
 * contact state we'd push (or have pushed) to the CRM.
 *
 * This is the same shape the per-event handlers compute *incrementally*
 * before each upsert call. We centralise the rules here so:
 *   1. The customer-360 GET endpoint can return a consistent snapshot.
 *   2. The handlers stay shallow — they call this and forward the diff.
 *   3. Tests can cover one function instead of five handler permutations.
 */

import type {
  GhlContactUpsert,
  GhlCustomFields,
} from './lib/ghl-client.js';
import type { StoredEvent } from './events.js';

export interface AggregateContact {
  userId: string;
  email?: string;
  phone?: string;
  country?: string;
  source?: string;
  customFields: GhlCustomFields;
  tags: readonly string[];
}

const DEFAULT_TOURNAMENT_TAG = 'tournament:wc2026';

/** Helper: round to 4 dp so floating-point drift doesn't churn the CRM field. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Project the event stream for one user down to the GHL contact state.
 *
 * Key shaping rules:
 *   - `total_predictions` counts `prediction_locked` events.
 *   - `last_pick_at` is the ISO timestamp of the most recent
 *     `prediction_locked`.
 *   - `last_lock_in_odds_avg` is the running mean of `oddsAtLock` across
 *     all locked predictions for this user.
 *   - `current_rank` mirrors the most recent `match_settled.newRank`.
 *   - `syndicates` is a CSV of distinct syndicateSlug values, in
 *     first-join order.
 *   - `humanness_score` is a placeholder 0 (real signal lands with the
 *     identity service, doc 20).
 *   - Tags: `tournament:wc2026` once any event is seen; `made_pick` once
 *     a prediction is locked; `evangelist` after at least one share;
 *     `syndicate:<slug>` per syndicate join.
 */
export function aggregateForUser(
  userId: string,
  events: readonly StoredEvent[],
): AggregateContact {
  let email: string | undefined;
  let phone: string | undefined;
  let country: string | undefined;
  let source: string | undefined;

  let totalPredictions = 0;
  let oddsSum = 0;
  let oddsCount = 0;
  let lastPickAtTs: number | undefined;
  let currentRank: number | undefined;
  const syndicates: string[] = [];
  const seenSyndicates = new Set<string>();
  let hasShare = false;

  for (const e of events) {
    switch (e.kind) {
      case 'user_signup': {
        // Identity fields stay last-write-wins so a second signup (e.g. a
        // re-verification) can update email/phone/country in place.
        if (e.email) email = e.email;
        if (e.phone) phone = e.phone;
        if (e.country) country = e.country;
        if (e.source) source = e.source;
        break;
      }
      case 'prediction_locked': {
        totalPredictions += 1;
        oddsSum += e.oddsAtLock;
        oddsCount += 1;
        if (lastPickAtTs === undefined || e.ts > lastPickAtTs) {
          lastPickAtTs = e.ts;
        }
        break;
      }
      case 'syndicate_joined': {
        if (!seenSyndicates.has(e.syndicateSlug)) {
          seenSyndicates.add(e.syndicateSlug);
          syndicates.push(e.syndicateSlug);
        }
        break;
      }
      case 'bracket_shared': {
        hasShare = true;
        break;
      }
      case 'match_settled': {
        // Always take the latest settled rank — a later event with a
        // smaller `ts` would be a replay and shouldn't clobber a newer one.
        currentRank = e.newRank;
        break;
      }
    }
  }

  const customFields: GhlCustomFields = {
    vtourn_user_id: userId,
    humanness_score: 0,
    total_predictions: totalPredictions,
  };
  if (currentRank !== undefined) customFields.current_rank = currentRank;
  if (syndicates.length > 0) customFields.syndicates = syndicates.join(',');
  if (lastPickAtTs !== undefined) {
    customFields.last_pick_at = new Date(lastPickAtTs * 1000).toISOString();
  }
  if (oddsCount > 0) {
    customFields.last_lock_in_odds_avg = round4(oddsSum / oddsCount);
  }
  if (country) customFields.device_country = country;

  const tags = new Set<string>();
  if (events.length > 0) tags.add(DEFAULT_TOURNAMENT_TAG);
  if (totalPredictions > 0) tags.add('made_pick');
  if (hasShare) tags.add('evangelist');
  for (const s of syndicates) tags.add(`syndicate:${s}`);

  return {
    userId,
    email,
    phone,
    country,
    source,
    customFields,
    tags: [...tags],
  };
}

/**
 * Build the upsert payload pushed to GHL after an individual event lands.
 * Tags live in `addTags`; the mock client never removes tags by default,
 * matching prod behaviour where engagement-band churn is a separate flow.
 */
export function upsertFromAggregate(c: AggregateContact): GhlContactUpsert {
  return {
    userId: c.userId,
    email: c.email,
    phone: c.phone,
    country: c.country,
    source: c.source,
    customFields: c.customFields,
    addTags: c.tags,
  };
}
