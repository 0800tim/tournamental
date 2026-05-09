/**
 * Unit tests for the partner registry — JSON load, env override, geo gating.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildRegistry,
  loadPartners,
  buildRedirectUrl,
  nzPolymarketExclusion,
} from '../src/partners';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function writeTempPartners(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'aff-router-'));
  const file = join(dir, 'partners.json');
  writeFileSync(file, JSON.stringify(json));
  return file;
}

describe('loadPartners', () => {
  it('loads the bundled partners.json', () => {
    const partners = loadPartners();
    expect(partners.length).toBeGreaterThanOrEqual(5);
    const ids = partners.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'polymarket',
        'bet365',
        'sky-nz',
        'espn-plus',
        'dazn',
      ]),
    );
  });

  it('applies AFFCODE_<PARTNER> env override', () => {
    process.env.AFFCODE_POLYMARKET = 'real-poly-code-123';
    const partners = loadPartners();
    const poly = partners.find((p) => p.id === 'polymarket');
    expect(poly?.affiliate_param_value).toBe('real-poly-code-123');
  });

  it('falls back to the placeholder when env var is unset', () => {
    delete process.env.AFFCODE_POLYMARKET;
    const partners = loadPartners();
    const poly = partners.find((p) => p.id === 'polymarket');
    expect(poly?.affiliate_param_value).toBe('AFFCODE_PLACEHOLDER_polymarket');
  });

  it('rejects an invalid partners.json (bad country code)', () => {
    const path = writeTempPartners({
      partners: [
        {
          id: 'foo',
          name: 'Foo',
          kind: 'sportsbook',
          base_url: 'https://foo.example',
          affiliate_param_name: 'ref',
          affiliate_param_value: 'AFFCODE_PLACEHOLDER_foo',
          allowed_countries: ['usa'], // invalid (must be 2 letters)
          offer_text: 'foo',
          logo_url: 'https://cdn.example/foo.svg',
        },
      ],
    });
    expect(() => loadPartners(path)).toThrow();
  });

  it('rejects duplicate partner ids', () => {
    const partner = {
      id: 'dup',
      name: 'Dup',
      kind: 'sportsbook',
      base_url: 'https://dup.example',
      affiliate_param_name: 'ref',
      affiliate_param_value: 'x-y-z-12345',
      allowed_countries: ['US'],
      offer_text: 'x',
      logo_url: 'https://cdn.example/dup.svg',
    };
    const path = writeTempPartners({ partners: [partner, partner] });
    expect(() => loadPartners(path)).toThrow(/duplicate partner id/);
  });
});

describe('nzPolymarketExclusion', () => {
  it('NZ + polymarket → true', () => {
    expect(nzPolymarketExclusion('polymarket', 'NZ')).toBe(true);
  });
  it('NZ + sky-nz → false (allowed)', () => {
    expect(nzPolymarketExclusion('sky-nz', 'NZ')).toBe(false);
  });
  it('US + polymarket → false', () => {
    expect(nzPolymarketExclusion('polymarket', 'US')).toBe(false);
  });
  it('handles lowercase country', () => {
    expect(nzPolymarketExclusion('polymarket', 'nz')).toBe(true);
  });
});

describe('PartnerRegistry', () => {
  const partners = loadPartners();
  const reg = buildRegistry(partners);

  it('isAllowed: NZ + polymarket → false (NZ DIA)', () => {
    expect(reg.isAllowed('polymarket', 'NZ')).toBe(false);
  });

  it('isAllowed: US + polymarket → true', () => {
    expect(reg.isAllowed('polymarket', 'US')).toBe(true);
  });

  it('isAllowed: NZ + sky-nz → true', () => {
    expect(reg.isAllowed('sky-nz', 'NZ')).toBe(true);
  });

  it('isAllowed: unknown partner → false', () => {
    expect(reg.isAllowed('nonexistent', 'US')).toBe(false);
  });

  it('forCountry(NZ) excludes polymarket', () => {
    const ids = reg.forCountry('NZ').map((p) => p.id);
    expect(ids).not.toContain('polymarket');
    expect(ids).toContain('sky-nz');
  });
});

describe('buildRedirectUrl', () => {
  const partners = loadPartners();
  const polymarket = partners.find((p) => p.id === 'polymarket')!;
  const dazn = partners.find((p) => p.id === 'dazn')!;

  it('uses the partner-defined affiliate param name', () => {
    const u = new URL(buildRedirectUrl(polymarket, { surface: 'bracket' }));
    expect(u.searchParams.get('ref')).toBe(
      polymarket.affiliate_param_value,
    );
  });

  it('passes context fields as vt_* sub-ids', () => {
    const u = new URL(
      buildRedirectUrl(polymarket, {
        surface: 'match',
        match_id: 'arg-fra',
        team_code: 'ARG',
        campaign_id: 'cmp-7',
      }),
    );
    expect(u.searchParams.get('vt_surface')).toBe('match');
    expect(u.searchParams.get('vt_match')).toBe('arg-fra');
    expect(u.searchParams.get('vt_team')).toBe('ARG');
    expect(u.searchParams.get('vt_campaign')).toBe('cmp-7');
  });

  it('uses different param key for DAZN (promo, not ref)', () => {
    const u = new URL(buildRedirectUrl(dazn, { surface: 'marketing' }));
    expect(u.searchParams.get('promo')).toBe(dazn.affiliate_param_value);
    expect(u.searchParams.get('ref')).toBeNull();
  });

  it('produces a valid absolute URL pointing at the partner host', () => {
    const u = new URL(buildRedirectUrl(polymarket, { surface: 'bracket' }));
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('polymarket.com');
  });
});
