/**
 * Partner registry — loads `data/partners.json` plus any per-partner overrides
 * from environment variables.
 *
 * Affiliate codes in the JSON file are placeholders (`AFFCODE_PLACEHOLDER_*`).
 * The real codes are read from env at boot time using the convention
 *   AFFCODE_<PARTNER_ID_UPPER>      e.g. AFFCODE_POLYMARKET
 * If unset, the placeholder is used (dev only — production should fail fast on
 * a placeholder via the env check at boot, see server.ts).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const PartnerKindSchema = z.enum([
  'prediction-market',
  'sportsbook',
  'paytv-stream',
]);
export type PartnerKind = z.infer<typeof PartnerKindSchema>;

export const PartnerSchema = z.object({
  id: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, 'partner id must be kebab-case lowercase'),
  name: z.string().min(1),
  kind: PartnerKindSchema,
  base_url: z.string().url(),
  affiliate_param_name: z.string().min(1),
  affiliate_param_value: z.string().min(1),
  allowed_countries: z
    .array(z.string().regex(/^[A-Z]{2}$/, 'ISO-3166-1 alpha-2 (uppercase)'))
    .min(1),
  offer_text: z.string().min(1),
  logo_url: z.string().url(),
});
export type Partner = z.infer<typeof PartnerSchema>;

const PartnersFileSchema = z.object({
  partners: z.array(PartnerSchema).min(1),
});

export interface PartnerRegistry {
  list(): Partner[];
  byId(id: string): Partner | undefined;
  forCountry(country: string): Partner[];
  isAllowed(id: string, country: string): boolean;
}

/** Hard-coded NZ-Polymarket exclusion check (defence in depth — not just JSON). */
export function nzPolymarketExclusion(partnerId: string, country: string): boolean {
  return partnerId === 'polymarket' && country.toUpperCase() === 'NZ';
}

function applyEnvOverride(p: Partner): Partner {
  const envKey = `AFFCODE_${p.id.toUpperCase().replace(/-/g, '_')}`;
  const v = process.env[envKey];
  if (v && v.length > 0) {
    return { ...p, affiliate_param_value: v };
  }
  return p;
}

function defaultPartnersPath(): string {
  // Resolve relative to the compiled module location:
  //   src/partners.ts          (dev, tsx)
  //   dist/partners.js         (prod)
  // In both cases data/partners.json sits two levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'data', 'partners.json');
}

export function loadPartners(path?: string): Partner[] {
  const file = path ?? process.env.AFFILIATE_PARTNERS_PATH ?? defaultPartnersPath();
  const raw = readFileSync(file, 'utf8');
  const parsed = PartnersFileSchema.parse(JSON.parse(raw));
  // Detect dup ids defensively.
  const seen = new Set<string>();
  for (const p of parsed.partners) {
    if (seen.has(p.id)) {
      throw new Error(`duplicate partner id in ${file}: ${p.id}`);
    }
    seen.add(p.id);
  }
  return parsed.partners.map(applyEnvOverride);
}

export function buildRegistry(partners: Partner[]): PartnerRegistry {
  const byIdMap = new Map<string, Partner>();
  for (const p of partners) byIdMap.set(p.id, p);
  return {
    list: () => [...partners],
    byId: (id) => byIdMap.get(id),
    forCountry: (country) => {
      const cc = country.toUpperCase();
      return partners.filter(
        (p) =>
          p.allowed_countries.includes(cc) && !nzPolymarketExclusion(p.id, cc),
      );
    },
    isAllowed: (id, country) => {
      const p = byIdMap.get(id);
      if (!p) return false;
      const cc = country.toUpperCase();
      if (nzPolymarketExclusion(id, cc)) return false;
      return p.allowed_countries.includes(cc);
    },
  };
}

/**
 * Build the final redirect URL for a partner click. Preserves any existing
 * query string in `base_url` and appends the affiliate ref + optional context
 * params (match_id, team_code, surface) for downstream attribution where the
 * partner supports custom sub-IDs.
 */
export function buildRedirectUrl(
  partner: Partner,
  ctx: {
    surface: string;
    match_id?: string;
    team_code?: string;
    campaign_id?: string;
  },
): string {
  const u = new URL(partner.base_url);
  u.searchParams.set(partner.affiliate_param_name, partner.affiliate_param_value);
  // Common partner sub-id slots are typically `subid`, `s1`, etc. We use
  // `vt_surface` / `vt_match` etc. as our own pass-through; partners that ignore
  // unknown params will simply drop them.
  u.searchParams.set('vt_surface', ctx.surface);
  if (ctx.match_id) u.searchParams.set('vt_match', ctx.match_id);
  if (ctx.team_code) u.searchParams.set('vt_team', ctx.team_code);
  if (ctx.campaign_id) u.searchParams.set('vt_campaign', ctx.campaign_id);
  return u.toString();
}
