import { describe, it, expect } from 'vitest';
import { signSessionJwt, verifySessionJwt } from '../src/jwt.js';

const SECRET = 'test-secret-32-chars-aaaaaaaaaaaa';

describe('jwt', () => {
  it('sign + verify roundtrip', async () => {
    const t = await signSessionJwt({
      secret: SECRET,
      userId: 'u_abc',
      phone: '+6421999000',
    });
    expect(t.jwt.split('.').length).toBe(3);
    const claims = await verifySessionJwt({ secret: SECRET, token: t.jwt });
    expect(claims.sub).toBe('u_abc');
    expect(claims.phone).toBe('+6421999000');
    expect(claims.jti).toBe(t.jti);
  });

  it('rejects tokens signed with wrong secret', async () => {
    const t = await signSessionJwt({
      secret: SECRET,
      userId: 'u_abc',
      phone: '+6421999000',
    });
    await expect(
      verifySessionJwt({ secret: 'different-32-char-secret-aaaaaaa', token: t.jwt }),
    ).rejects.toThrow();
  });

  it('rejects tampered tokens', async () => {
    const t = await signSessionJwt({
      secret: SECRET,
      userId: 'u_abc',
      phone: '+6421999000',
    });
    const parts = t.jwt.split('.');
    const tampered = `${parts[0]}.${parts[1]}AA.${parts[2]}`;
    await expect(
      verifySessionJwt({ secret: SECRET, token: tampered }),
    ).rejects.toThrow();
  });

  it('rejects expired tokens', async () => {
    const t = await signSessionJwt({
      secret: SECRET,
      userId: 'u_abc',
      phone: '+6421999000',
      ttlSeconds: -10,
    });
    await expect(
      verifySessionJwt({ secret: SECRET, token: t.jwt }),
    ).rejects.toThrow();
  });
});
