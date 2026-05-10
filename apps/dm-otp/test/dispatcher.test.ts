import { describe, it, expect, vi } from 'vitest';
import { CodeStore } from '../src/lib/code-store.js';
import { dispatch, isLoginPhrase, type SendFn } from '../src/lib/dispatcher.js';

const SECRET = 'test-secret-test-secret-test-secret-1234';

describe('isLoginPhrase', () => {
  it('matches common phrases case-insensitively', () => {
    expect(isLoginPhrase('log in')).toBe(true);
    expect(isLoginPhrase('Log In')).toBe(true);
    expect(isLoginPhrase('LOGIN')).toBe(true);
    expect(isLoginPhrase('  sign in  ')).toBe(true);
    expect(isLoginPhrase('hello')).toBe(false);
    expect(isLoginPhrase('please log me in')).toBe(false);
  });
});

describe('dispatch', () => {
  it('issues a code and calls the channel sender on a recognised phrase', async () => {
    const store = new CodeStore({ secret: SECRET });
    const send = vi.fn<SendFn>().mockResolvedValue({ ok: true, status: 200 });
    const senders = new Map<string, SendFn>([['discord', send]]);
    const result = await dispatch(
      { store, senders },
      { channel: 'discord', externalId: '987', text: 'log in' },
    );
    expect(result.ok).toBe(true);
    expect(result.recognised).toBe(true);
    expect(result.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const [extId, code] = send.mock.calls[0];
    expect(extId).toBe('987');
    expect(code).toMatch(/^\d{6}$/);
    expect(store.peek('discord', '987')).toBeTruthy();
  });

  it('ignores non-login text without calling the sender', async () => {
    const store = new CodeStore({ secret: SECRET });
    const send = vi.fn<SendFn>();
    const senders = new Map<string, SendFn>([['telegram', send]]);
    const result = await dispatch(
      { store, senders },
      { channel: 'telegram', externalId: 'c1', text: 'hi there' },
    );
    expect(result.recognised).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns no-sender if channel has no adapter wired', async () => {
    const store = new CodeStore({ secret: SECRET });
    const senders = new Map<string, SendFn>();
    const result = await dispatch(
      { store, senders },
      { channel: 'mastodon', externalId: 'u', text: 'log in' },
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe('no-sender');
  });

  it('uses a magic token (long string) for magic-link channels', async () => {
    const store = new CodeStore({ secret: SECRET });
    const send = vi.fn<SendFn>().mockResolvedValue({ ok: true });
    const senders = new Map<string, SendFn>([['email', send]]);
    await dispatch(
      {
        store,
        senders,
        magicLinkChannels: new Set(['email']),
      },
      { channel: 'email', externalId: 'a@b.com', text: 'log in' },
    );
    const [, code] = send.mock.calls[0];
    expect(code.length).toBeGreaterThan(20);
  });
});
