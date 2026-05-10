/**
 * Per-event handler tests. Each event type:
 *   - Must validate.
 *   - Must record a GHL upsert with the right custom fields + tags.
 *   - Must be idempotent on eventId.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../src/server.js';
import { MockGhlClient } from '../src/lib/ghl-client.js';

const FROZEN_TS = 1_715_000_000;

let app: FastifyInstance;
let ghl: MockGhlClient;

async function bootstrap() {
  ghl = new MockGhlClient({ jsonlPath: null, now: () => FROZEN_TS });
  const built = await buildServer({
    ghlClient: ghl,
    now: () => FROZEN_TS,
    ghlLogPath: null,
    logger: false,
  });
  app = built.app;
}

describe('POST /v1/events/user_signup', () => {
  beforeEach(bootstrap);
  afterEach(async () => {
    await app.close();
  });

  it('400 when payload is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events/user_signup',
      payload: { eventId: 'e1', userId: 'u1' }, // missing source
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().reason).toBe('invalid_params');
  });

  it('records upsert + tournament tag on signup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/events/user_signup',
      payload: {
        eventId: 'evt_signup_1',
        userId: 'u_42',
        email: 'jane@example.com',
        phone: '+64211234567',
        country: 'NZ',
        source: 'telegram',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
    expect(res.json().contactId).toBe('u_42');

    const calls = ghl.recordedCalls();
    const upsert = calls.find((c) => c.op === 'upsert_contact');
    expect(upsert).toBeDefined();
    expect(upsert!.payload).toMatchObject({
      email: 'jane@example.com',
      phone: '+64211234567',
      country: 'NZ',
      source: 'telegram',
    });

    const cf = calls.find((c) => c.op === 'set_custom_fields');
    expect(cf).toBeDefined();
    expect(cf!.payload.customFields).toMatchObject({
      vtourn_user_id: 'u_42',
      humanness_score: 0,
      total_predictions: 0,
      device_country: 'NZ',
    });

    const tags = calls.find((c) => c.op === 'add_tags');
    expect(tags).toBeDefined();
    expect(tags!.payload.tags).toContain('tournament:wc2026');
    expect(tags!.payload.tags).not.toContain('made_pick');
  });

  it('is idempotent on duplicate eventId (no second upsert)', async () => {
    const payload = {
      eventId: 'evt_dupe_1',
      userId: 'u_dupe',
      source: 'web',
    };
    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/events/user_signup',
      payload,
    });
    expect(r1.json().accepted).toBe(true);
    const callsAfterFirst = ghl.recordedCalls().length;

    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/events/user_signup',
      payload,
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().accepted).toBe(false);
    expect(r2.json().reason).toBe('duplicate_event');
    expect(ghl.recordedCalls().length).toBe(callsAfterFirst);
  });
});

describe('POST /v1/events/prediction_locked', () => {
  beforeEach(bootstrap);
  afterEach(async () => {
    await app.close();
  });

  it('records made_pick tag and updates custom fields', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/events/user_signup',
      payload: {
        eventId: 'sg1',
        userId: 'u_pred',
        source: 'web',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/events/prediction_locked',
      payload: {
        eventId: 'pred_1',
        userId: 'u_pred',
        matchId: '7',
        outcome: 'home_win',
        oddsAtLock: 0.62,
        ts: FROZEN_TS,
      },
    });
    expect(res.statusCode).toBe(200);

    // Most recent set_custom_fields and add_tags reflect the prediction.
    const calls = ghl.recordedCalls();
    const cfCalls = calls.filter((c) => c.op === 'set_custom_fields');
    const lastCf = cfCalls[cfCalls.length - 1];
    expect(lastCf.payload.customFields).toMatchObject({
      total_predictions: 1,
      last_lock_in_odds_avg: 0.62,
    });
    expect(lastCf.payload.customFields).toHaveProperty('last_pick_at');

    const tagCalls = calls.filter((c) => c.op === 'add_tags');
    const lastTags = tagCalls[tagCalls.length - 1];
    expect(lastTags.payload.tags).toContain('made_pick');
    expect(lastTags.payload.tags).toContain('tournament:wc2026');
  });

  it('averages odds across two locked predictions', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/events/prediction_locked',
      payload: {
        eventId: 'p1',
        userId: 'u_avg',
        matchId: '1',
        outcome: 'home_win',
        oddsAtLock: 0.5,
        ts: FROZEN_TS,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/events/prediction_locked',
      payload: {
        eventId: 'p2',
        userId: 'u_avg',
        matchId: '2',
        outcome: 'away_win',
        oddsAtLock: 0.3,
        ts: FROZEN_TS + 60,
      },
    });

    const cfCalls = ghl
      .recordedCalls()
      .filter((c) => c.op === 'set_custom_fields' && c.userId === 'u_avg');
    const last = cfCalls[cfCalls.length - 1];
    expect(last.payload.customFields).toMatchObject({
      total_predictions: 2,
      last_lock_in_odds_avg: 0.4,
    });
  });
});

describe('POST /v1/events/syndicate_joined', () => {
  beforeEach(bootstrap);
  afterEach(async () => {
    await app.close();
  });

  it('adds syndicate:<slug> tag and CSV custom field', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/events/syndicate_joined',
      payload: {
        eventId: 's1',
        userId: 'u_synd',
        syndicateSlug: 'kiwi-crew',
        role: 'member',
        ts: FROZEN_TS,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/events/syndicate_joined',
      payload: {
        eventId: 's2',
        userId: 'u_synd',
        syndicateSlug: 'wallabies',
        role: 'captain',
        ts: FROZEN_TS + 1,
      },
    });

    const calls = ghl
      .recordedCalls()
      .filter((c) => c.userId === 'u_synd');
    const lastTags = calls
      .filter((c) => c.op === 'add_tags')
      .at(-1);
    expect(lastTags!.payload.tags).toEqual(
      expect.arrayContaining([
        'tournament:wc2026',
        'syndicate:kiwi-crew',
        'syndicate:wallabies',
      ]),
    );

    const lastCf = calls
      .filter((c) => c.op === 'set_custom_fields')
      .at(-1);
    expect(lastCf!.payload.customFields).toMatchObject({
      syndicates: 'kiwi-crew,wallabies',
    });
  });
});

describe('POST /v1/events/bracket_shared', () => {
  beforeEach(bootstrap);
  afterEach(async () => {
    await app.close();
  });

  it('grants the evangelist tag on first share', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/events/bracket_shared',
      payload: {
        eventId: 'sh1',
        userId: 'u_evan',
        channel: 'whatsapp',
        ts: FROZEN_TS,
      },
    });
    const lastTags = ghl
      .recordedCalls()
      .filter((c) => c.op === 'add_tags' && c.userId === 'u_evan')
      .at(-1);
    expect(lastTags!.payload.tags).toContain('evangelist');
  });
});

describe('POST /v1/events/match_settled', () => {
  beforeEach(bootstrap);
  afterEach(async () => {
    await app.close();
  });

  it('updates current_rank custom field', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/events/match_settled',
      payload: {
        eventId: 'm1',
        userId: 'u_rank',
        matchId: '1',
        deltaPoints: 12,
        newRank: 47,
        ts: FROZEN_TS,
      },
    });
    const lastCf = ghl
      .recordedCalls()
      .filter((c) => c.op === 'set_custom_fields' && c.userId === 'u_rank')
      .at(-1);
    expect(lastCf!.payload.customFields).toMatchObject({ current_rank: 47 });
  });
});
