import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Storage } from '../src/storage.js';

let s: Storage;
beforeEach(() => {
  s = new Storage({ path: ':memory:' });
});
afterEach(() => s.close());

describe('UserRecord is_bot column', () => {
  it('defaults is_bot to 0 for users created via findOrCreateUser', () => {
    const u = s.findOrCreateUser('+6421000001', 100);
    expect(u.is_bot).toBe(0);
    const reloaded = s.getUser(u.id);
    expect(reloaded?.is_bot).toBe(0);
  });

  it('defaults is_bot to 0 for users created via findOrCreateEmailUser', () => {
    const u = s.findOrCreateEmailUser('dev@example.com', 100);
    expect(u.is_bot).toBe(0);
  });

  it('defaults is_bot to 0 for telegram users', () => {
    const u = s.findOrCreateTelegramUser({
      telegramId: 12345,
      telegramUsername: 'someone',
      displayName: 'Some One',
      phone: null,
      now: 100,
    });
    expect(u.is_bot).toBe(0);
  });

  it('insertBotUser persists is_bot=1 and round-trips through getUser', () => {
    const bot = s.insertBotUser({
      id: 'bot_abc12345',
      display_name: 'Carlos_BRA_42',
      country: 'BR',
      created_at: 100,
    });
    expect(bot.is_bot).toBe(1);
    const reloaded = s.getUser('bot_abc12345');
    expect(reloaded?.is_bot).toBe(1);
    expect(reloaded?.id).toBe('bot_abc12345');
  });

  it('has an idx_user_is_bot index after migration', () => {
    const rows = s.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_user_is_bot'`,
      )
      .all() as { name: string }[];
    expect(rows.length).toBe(1);
  });
});
