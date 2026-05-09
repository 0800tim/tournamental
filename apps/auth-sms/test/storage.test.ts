import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage, phoneLogId } from '../src/storage.js';

let s: Storage;
beforeEach(() => {
  s = new Storage({ path: ':memory:' });
});
afterEach(() => s.close());

describe('storage', () => {
  it('upsert + get OTP roundtrip', () => {
    s.upsertOtp({
      phone: '+6421000001',
      otp_hash: 'aa',
      channel: 'sms',
      attempts: 0,
      expires_at: 100,
      created_at: 50,
    });
    const r = s.getOtp('+6421000001');
    expect(r?.otp_hash).toBe('aa');
    expect(r?.channel).toBe('sms');
  });

  it('upsert overwrites existing OTP for same phone', () => {
    s.upsertOtp({
      phone: '+6421000001',
      otp_hash: 'aa',
      channel: 'sms',
      attempts: 3,
      expires_at: 100,
      created_at: 50,
    });
    s.upsertOtp({
      phone: '+6421000001',
      otp_hash: 'bb',
      channel: 'whatsapp',
      attempts: 0,
      expires_at: 200,
      created_at: 150,
    });
    const r = s.getOtp('+6421000001');
    expect(r?.otp_hash).toBe('bb');
    expect(r?.channel).toBe('whatsapp');
    expect(r?.attempts).toBe(0);
  });

  it('incrementOtpAttempts returns new value', () => {
    s.upsertOtp({
      phone: '+6421000001',
      otp_hash: 'aa',
      channel: 'sms',
      attempts: 0,
      expires_at: 100,
      created_at: 50,
    });
    expect(s.incrementOtpAttempts('+6421000001')).toBe(1);
    expect(s.incrementOtpAttempts('+6421000001')).toBe(2);
  });

  it('pruneExpiredOtps removes only expired rows', () => {
    s.upsertOtp({
      phone: '+6421000001',
      otp_hash: 'aa',
      channel: 'sms',
      attempts: 0,
      expires_at: 100,
      created_at: 50,
    });
    s.upsertOtp({
      phone: '+6421000002',
      otp_hash: 'bb',
      channel: 'sms',
      attempts: 0,
      expires_at: 999,
      created_at: 50,
    });
    expect(s.pruneExpiredOtps(500)).toBe(1);
    expect(s.getOtp('+6421000001')).toBeNull();
    expect(s.getOtp('+6421000002')).not.toBeNull();
  });

  it('findOrCreateUser returns existing user on second call', () => {
    const u1 = s.findOrCreateUser('+6421000001', 100);
    const u2 = s.findOrCreateUser('+6421000001', 200);
    expect(u1.id).toBe(u2.id);
    expect(u2.last_seen_at).toBe(200);
    expect(s.getUser(u1.id)?.id).toBe(u1.id);
  });

  it('insertSession + getSessionByJti + revokeSessionByJti', () => {
    const u = s.findOrCreateUser('+6421000001', 100);
    s.insertSession({
      id: 'jti-1',
      user_id: u.id,
      jwt_jti: 'jti-1',
      created_at: 100,
      expires_at: 200,
      user_agent: 'test',
      ip: '1.1.1.1',
    });
    expect(s.getSessionByJti('jti-1')?.user_id).toBe(u.id);
    s.revokeSessionByJti('jti-1');
    expect(s.getSessionByJti('jti-1')).toBeNull();
  });

  it('rate bucket increment + read', () => {
    expect(s.bumpRateBucket('k', 1000)).toBe(1);
    expect(s.bumpRateBucket('k', 1000)).toBe(2);
    expect(s.getRateBucket('k', 1000)).toBe(2);
    expect(s.getRateBucket('k', 2000)).toBe(0);
  });

  it('phoneLogId is deterministic and short', () => {
    const a = phoneLogId('+6421000001');
    const b = phoneLogId('+6421000001');
    expect(a).toBe(b);
    expect(a).toHaveLength(12);
    expect(a).not.toContain('+');
  });
});
