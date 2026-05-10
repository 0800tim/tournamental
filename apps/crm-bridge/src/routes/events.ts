/**
 * POST /v1/events/* — accept events from other VTourn services and forward
 * a coherent contact upsert into GoHighLevel.
 *
 * Every endpoint is idempotent on `eventId`. A duplicate POST returns 200
 * with `{ accepted: false, reason: 'duplicate_event' }` and does NOT issue
 * another GHL upsert.
 *
 * The handlers are deliberately thin: validate → store → recompute the
 * full aggregate for that user → upsert. Recomputing every time keeps the
 * GHL view a true reflection of stored state and avoids drift if events
 * arrive out-of-order.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z, ZodTypeAny } from 'zod';

import type { AppContext } from '../context.js';
import {
  BracketSharedEventSchema,
  MatchSettledEventSchema,
  PredictionLockedEventSchema,
  SyndicateJoinedEventSchema,
  UserSignupEventSchema,
  type StoredEvent,
} from '../events.js';
import { aggregateForUser, upsertFromAggregate } from '../aggregate.js';

interface IngestResult<E> {
  status: number;
  body: {
    accepted: boolean;
    reason?: string;
    eventId: string;
    contactId?: string;
    issues?: Array<{ path: string; message: string }>;
    event?: E;
  };
}

/**
 * Generic ingest pipeline: parse with Zod, wrap in the kind-discriminated
 * envelope, persist via the store (which enforces idempotency), then
 * forward the recomputed aggregate to GHL.
 */
async function ingest<S extends ZodTypeAny, K extends StoredEvent['kind']>(
  ctx: AppContext,
  req: FastifyRequest,
  schema: S,
  kind: K,
): Promise<IngestResult<z.infer<S>>> {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        accepted: false,
        reason: 'invalid_params',
        eventId: '',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    };
  }

  const data = parsed.data as z.infer<S>;
  const stored = { kind, ...data } as StoredEvent;
  const result = ctx.store.accept(stored);
  if (!result.accepted) {
    return {
      status: 200,
      body: {
        accepted: false,
        reason: 'duplicate_event',
        eventId: stored.eventId,
        event: data,
      },
    };
  }

  const aggregate = aggregateForUser(
    stored.userId,
    ctx.store.eventsForUser(stored.userId),
  );
  const { contactId } = await ctx.ghl.upsertContact(
    upsertFromAggregate(aggregate),
  );

  return {
    status: 200,
    body: {
      accepted: true,
      eventId: stored.eventId,
      contactId,
      event: data,
    },
  };
}

function reply(reply: FastifyReply, r: IngestResult<unknown>) {
  reply.code(r.status).header('Cache-Control', 'no-store');
  return r.body;
}

export async function registerEvents(app: FastifyInstance, ctx: AppContext) {
  app.post('/v1/events/user_signup', async (req, res) => {
    const r = await ingest(ctx, req, UserSignupEventSchema, 'user_signup');
    return reply(res, r);
  });

  app.post('/v1/events/prediction_locked', async (req, res) => {
    const r = await ingest(
      ctx,
      req,
      PredictionLockedEventSchema,
      'prediction_locked',
    );
    return reply(res, r);
  });

  app.post('/v1/events/syndicate_joined', async (req, res) => {
    const r = await ingest(
      ctx,
      req,
      SyndicateJoinedEventSchema,
      'syndicate_joined',
    );
    return reply(res, r);
  });

  app.post('/v1/events/bracket_shared', async (req, res) => {
    const r = await ingest(
      ctx,
      req,
      BracketSharedEventSchema,
      'bracket_shared',
    );
    return reply(res, r);
  });

  app.post('/v1/events/match_settled', async (req, res) => {
    const r = await ingest(
      ctx,
      req,
      MatchSettledEventSchema,
      'match_settled',
    );
    return reply(res, r);
  });
}
