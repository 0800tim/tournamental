import { describe, it, expect } from 'vitest';
import { providers, PROVIDER_IDS } from '../src/lib/providers/index.js';

describe('provider adapters', () => {
  for (const id of PROVIDER_IDS) {
    it(`${id} returns a sensible mock authorize URL`, () => {
      const adapter = providers[id];
      const result = adapter.startLink({
        userId: 'u_test',
        state: 'st_test',
        redirectUri: 'https://example.test/cb',
      });
      expect(result.authorizeUrl).toMatch(/^https:\/\//);
      expect(result.authorizeUrl).toContain(id);
      expect(result.authorizeUrl).toContain('user_id=u_test');
      expect(result.authorizeUrl).toContain('state=st_test');
      expect(Array.isArray(result.expectedScopes)).toBe(true);
      expect(result.expectedScopes.length).toBeGreaterThan(0);
    });

    it(`${id} resolveCallback echoes externalId`, async () => {
      const adapter = providers[id];
      const profile = await adapter.resolveCallback({
        externalId: 'ext_123',
        profile: { displayName: 'Tim' },
      });
      expect(profile.externalId).toBe('ext_123');
    });
  }
});
