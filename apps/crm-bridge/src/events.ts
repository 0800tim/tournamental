/**
 * Event types accepted by /v1/events/*.
 *
 * Keep these structurally close to the prediction-history ledger shape we
 * forward from `apps/web` (see docs/12 + the future
 * `apps/web/lib/bracket/history.ts`). The CRM bridge doesn't *own* these
 * events — it's a forwarder — so the schema follows the producer.
 */

import { z } from 'zod';

const EventIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u, 'eventId must be url-safe');

const UserIdSchema = z.string().min(1).max(128);
const TsSchema = z.number().int().nonnegative();

export const UserSignupEventSchema = z.object({
  eventId: EventIdSchema,
  userId: UserIdSchema,
  email: z.string().email().optional(),
  phone: z
    .string()
    .min(6)
    .max(32)
    .regex(/^\+?[0-9 ()\-]+$/u, 'phone must be E.164-ish')
    .optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/u, 'country must be ISO alpha-2 uppercase')
    .optional(),
  source: z.string().min(1).max(64),
  ts: TsSchema.optional(),
});

export const PredictionLockedEventSchema = z.object({
  eventId: EventIdSchema,
  userId: UserIdSchema,
  matchId: z.string().min(1).max(64),
  outcome: z.enum(['home_win', 'draw', 'away_win']),
  /** 0–1 market-implied win probability at lock-in. */
  oddsAtLock: z.number().min(0).max(1),
  ts: TsSchema,
});

export const SyndicateJoinedEventSchema = z.object({
  eventId: EventIdSchema,
  userId: UserIdSchema,
  syndicateSlug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/u, 'syndicateSlug must be kebab-case lowercase'),
  role: z.enum(['member', 'captain', 'invited']),
  ts: TsSchema,
});

export const BracketSharedEventSchema = z.object({
  eventId: EventIdSchema,
  userId: UserIdSchema,
  channel: z.enum([
    'twitter',
    'whatsapp',
    'telegram',
    'instagram',
    'tiktok',
    'copy_link',
    'other',
  ]),
  ts: TsSchema,
});

export const MatchSettledEventSchema = z.object({
  eventId: EventIdSchema,
  userId: UserIdSchema,
  matchId: z.string().min(1).max(64),
  /** Points awarded (or negative; engine permits 0). */
  deltaPoints: z.number(),
  /** Tournament rank after this match settled. 1 = first. */
  newRank: z.number().int().positive(),
  ts: TsSchema,
});

export type UserSignupEvent = z.infer<typeof UserSignupEventSchema>;
export type PredictionLockedEvent = z.infer<typeof PredictionLockedEventSchema>;
export type SyndicateJoinedEvent = z.infer<typeof SyndicateJoinedEventSchema>;
export type BracketSharedEvent = z.infer<typeof BracketSharedEventSchema>;
export type MatchSettledEvent = z.infer<typeof MatchSettledEventSchema>;

/** Discriminated union over the persisted events for the customer aggregate. */
export type StoredEvent =
  | ({ kind: 'user_signup' } & UserSignupEvent)
  | ({ kind: 'prediction_locked' } & PredictionLockedEvent)
  | ({ kind: 'syndicate_joined' } & SyndicateJoinedEvent)
  | ({ kind: 'bracket_shared' } & BracketSharedEvent)
  | ({ kind: 'match_settled' } & MatchSettledEvent);

export type EventKind = StoredEvent['kind'];
