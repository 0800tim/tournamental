import { describe, it, expect } from 'vitest';

import {
  isPlausiblePhone,
  buildContactBody,
  adminUserUrl,
  PLAYER_TAG,
} from '../src/highlevel.js';
import type { UserRecord } from '../src/storage.js';

function user(partial: Partial<UserRecord>): UserRecord {
  return {
    id: 'u_test',
    phone: null,
    display_name: null,
    country: null,
    telegram_id: null,
    telegram_username: null,
    created_at: 0,
    last_seen_at: 0,
    email: null,
    first_name: null,
    last_name: null,
    city: null,
    favourite_team_code: null,
    highlevel_contact_id: null,
    highlevel_synced_at: null,
    ...partial,
  };
}

describe('isPlausiblePhone', () => {
  it('accepts real-looking numbers', () => {
    for (const p of ['+64226804259', '+6421535832', '+36302247277', '021 000 999']) {
      expect(isPlausiblePhone(p)).toBe(true);
    }
  });

  it('rejects repeated-digit junk', () => {
    for (const p of ['+13333333333', '+18888888888', '+1 555 555 5555']) {
      expect(isPlausiblePhone(p)).toBe(false);
    }
  });

  it('rejects sequential and too-short', () => {
    expect(isPlausiblePhone('1234567890')).toBe(false);
    expect(isPlausiblePhone('12345')).toBe(false);
    expect(isPlausiblePhone(null)).toBe(false);
    expect(isPlausiblePhone('')).toBe(false);
  });
});

describe('buildContactBody', () => {
  const loc = 'loc-123';

  it('always tags player and includes the linking custom fields', () => {
    const body = buildContactBody(user({ phone: '+64226804259' }), loc);
    expect(body.tags).toEqual([PLAYER_TAG]);
    const cf = body.customFields as Array<{ key: string; field_value: string }>;
    expect(cf.find((f) => f.key === 'vtourn_user_id')?.field_value).toBe('u_test');
    expect(cf.find((f) => f.key === 'vtourn_admin_url')?.field_value).toBe(
      adminUserUrl('u_test'),
    );
  });

  it('drops a bogus phone but keeps the email', () => {
    const body = buildContactBody(
      user({ phone: '+13333333333', email: 'a@b.com' }),
      loc,
    );
    expect(body.phone).toBeUndefined();
    expect(body.email).toBe('a@b.com');
  });

  it('keeps a real phone', () => {
    const body = buildContactBody(user({ phone: '+64226804259' }), loc);
    expect(body.phone).toBe('+64226804259');
  });

  it('derives name from first/last when display_name is absent', () => {
    const body = buildContactBody(
      user({ phone: '+64226804259', first_name: 'Theo', last_name: 'Thomas' }),
      loc,
    );
    expect(body.name).toBe('Theo Thomas');
  });
});
