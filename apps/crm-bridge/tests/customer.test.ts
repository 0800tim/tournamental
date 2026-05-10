/**
 * Customer-360 aggregate endpoint test. The endpoint must compose the
 * locally-cached events into a single contact view that matches what we
 * would push to GHL.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import { MockGhlClient } from '../src/lib/ghl-client.js';

const FROZEN_TS = 1_715_000_000;

let app: FastifyInstance;

async function bootstrap() {
  const ghl = new MockGhlClient({ jsonlPath: null, now: () => FROZEN_TS });
  const built = await buildServer({
    ghlClient: ghl,
    now: () => FROZEN_TS,
    ghlLogPath: null,
    logger: false,
  });
  app = built.app;
}

describe('GET /v1/customer/:userId', () => {
  beforeEach(bootstrap);
  afterEach(async () => {
    await app.close();
  });

  it('404 for an unknown user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/customer/u_ghost',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('user_not_found');
  });

  it('joins events into a coherent contact aggregate', async () => {
    const userId = 'u_360';
    // Signup → prediction → syndicate join → share → match settled.
    await app.inject({
      method: 'POST',
      url: '/v1/events/user_signup',
      payload: {
        eventId: 'e1',
        userId,
        email: 'kim@example.com',
        country: 'NZ',
        source: 'twitter-ad',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/events/prediction_locked',
      payload: {
        eventId: 'e2',
        userId,
        matchId: '5',
        outcome: 'home_win',
        oddsAtLock: 0.55,
        ts: FROZEN_TS,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/events/syndicate_joined',
      payload: {
        eventId: 'e3',
        userId,
        syndicateSlug: 'tui-fc',
        role: 'member',
        ts: FROZEN_TS + 5,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/events/bracket_shared',
      payload: {
        eventId: 'e4',
        userId,
        channel: 'twitter',
        ts: FROZEN_TS + 10,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/events/match_settled',
      payload: {
        eventId: 'e5',
        userId,
        matchId: '5',
        deltaPoints: 10,
        newRank: 312,
        ts: FROZEN_TS + 100,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/customer/${userId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.userId).toBe(userId);
    expect(body.events_total).toBe(5);
    expect(body.events).toHaveLength(5);
    expect(body.events.map((e: { kind: string }) => e.kind)).toEqual([
      'user_signup',
      'prediction_locked',
      'syndicate_joined',
      'bracket_shared',
      'match_settled',
    ]);

    expect(body.contact).toMatchObject({
      userId,
      email: 'kim@example.com',
      country: 'NZ',
      source: 'twitter-ad',
      customFields: {
        vtourn_user_id: userId,
        humanness_score: 0,
        total_predictions: 1,
        current_rank: 312,
        syndicates: 'tui-fc',
        last_lock_in_odds_avg: 0.55,
        device_country: 'NZ',
      },
    });
    expect(body.contact.customFields.last_pick_at).toBeDefined();
    expect(body.contact.tags).toEqual(
      expect.arrayContaining([
        'tournament:wc2026',
        'made_pick',
        'evangelist',
        'syndicate:tui-fc',
      ]),
    );
  });

  it('rejects userIds with disallowed characters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/customer/with%20space',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_params');
  });
});

describe('GET /healthz', () => {
  beforeEach(bootstrap);
  afterEach(async () => {
    await app.close();
  });

  it('returns service metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      service: '@vtorn/crm-bridge',
    });
  });
});
