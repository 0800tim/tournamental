import { describe, it, expect } from 'vitest';
import { CodeStore } from '../src/lib/code-store.js';
import { generateOtpCode } from '../src/otp.js';

const SECRET = 'test-secret-test-secret-test-secret-1234';

describe('CodeStore', () => {
  it('round-trips a code (issue then verify)', () => {
    const store = new CodeStore({ secret: SECRET });
    const code = generateOtpCode();
    store.put({ channel: 'telegram', externalId: '12345', code });

    const result = store.verify({ channel: 'telegram', externalId: '12345', code });
    expect(result.ok).toBe(true);
  });

  it('verify is single-use (second call sees not-found)', () => {
    const store = new CodeStore({ secret: SECRET });
    const code = generateOtpCode();
    store.put({ channel: 'telegram', externalId: '12345', code });
    store.verify({ channel: 'telegram', externalId: '12345', code });
    const second = store.verify({ channel: 'telegram', externalId: '12345', code });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('not-found');
  });

  it('rejects after TTL expires', () => {
    let now = 1_000_000;
    const store = new CodeStore({
      secret: SECRET,
      ttlSeconds: 60,
      now: () => now,
    });
    store.put({ channel: 'discord', externalId: 'u', code: '111111' });
    now += 61 * 1000;
    const result = store.verify({ channel: 'discord', externalId: 'u', code: '111111' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('locks out after maxAttempts', () => {
    const store = new CodeStore({ secret: SECRET, maxAttempts: 3 });
    store.put({ channel: 'slack', externalId: 'U1', code: '222222' });
    for (let i = 0; i < 3; i += 1) {
      const r = store.verify({ channel: 'slack', externalId: 'U1', code: '999999' });
      expect(r.ok).toBe(false);
    }
    // After lockout, even the right code is gone.
    const final = store.verify({ channel: 'slack', externalId: 'U1', code: '222222' });
    expect(final.ok).toBe(false);
  });

  it('verifyByToken finds an email magic-token without externalId', () => {
    const store = new CodeStore({ secret: SECRET });
    const token = 'abc-magic-token';
    store.put({ channel: 'email', externalId: 'a@b.com', code: token });
    const r = store.verifyByToken({ channel: 'email', code: token });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.externalId).toBe('a@b.com');
  });
});
