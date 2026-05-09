/**
 * GET /v1/affiliate/click — resolves an affiliate click, logs it, redirects.
 *
 * Query params:
 *   partner    (required)  partner id e.g. "polymarket"
 *   surface    (required)  "bracket" | "match" | "marketing"
 *   match_id   (optional)
 *   team_code  (optional)
 *   user_id    (optional)  hashed before storage
 *   campaign_id (optional)
 *   country    (optional)  dev override; production path uses cf-ipcountry
 *
 * Failure cases:
 *   400 — missing/invalid params
 *   404 — partner not found, or partner not allowed in resolved country
 *   422 — country could not be resolved
 *   429 — per-(user, partner) 24h cap exceeded (or per-IP via @fastify/rate-limit)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppContext } from '../context.js';
import { resolveCountryFromReq } from '../geo.js';
import { buildRedirectUrl, nzPolymarketExclusion } from '../partners.js';
import { hashUserId } from '../storage.js';

const SurfaceEnum = z.enum(['bracket', 'match', 'marketing']);

const QuerySchema = z.object({
  partner: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, 'partner must be kebab-case lowercase'),
  surface: SurfaceEnum,
  match_id: z.string().min(1).max(64).optional(),
  team_code: z
    .string()
    .regex(/^[A-Z]{3}$/u, 'team_code must be 3 uppercase letters')
    .optional(),
  user_id: z.string().min(1).max(128).optional(),
  campaign_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/u, 'campaign_id must be url-safe')
    .optional(),
  country: z.string().optional(),
});

/** Maximum number of clicks for one (user, partner) in the trailing 24h. */
export const PER_USER_PARTNER_DAILY_CAP = 3;

export async function registerClick(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/affiliate/click', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .header('Cache-Control', 'no-store')
        .send({
          error: 'invalid_params',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
    }

    const q = parsed.data;
    const partner = ctx.registry.byId(q.partner);
    if (!partner) {
      return reply
        .code(404)
        .header('Cache-Control', 'no-store')
        .send({ error: 'partner_not_found', partner: q.partner });
    }

    const country = resolveCountryFromReq(req);
    if (!country) {
      return reply
        .code(422)
        .header('Cache-Control', 'no-store')
        .send({ error: 'country_unresolved' });
    }

    // Hard rule: NZ never sees Polymarket.
    if (nzPolymarketExclusion(partner.id, country)) {
      req.log.info(
        { partner: partner.id, country, surface: q.surface },
        'affiliate click blocked: nz-polymarket exclusion',
      );
      return reply.code(404).header('Cache-Control', 'no-store').send({
        reason: 'geo_excluded',
        country,
        partner: partner.id,
      });
    }

    if (!ctx.registry.isAllowed(partner.id, country)) {
      return reply.code(404).header('Cache-Control', 'no-store').send({
        reason: 'geo_excluded',
        country,
        partner: partner.id,
      });
    }

    // Per-(user, partner) dedupe: max 3 / 24h.
    let userIdHash: string | null = null;
    if (q.user_id) {
      userIdHash = hashUserId(q.user_id, ctx.userHashSalt);
      const sinceTs = ctx.now() - 24 * 3600;
      const recent = ctx.store.countUserPartner(userIdHash, partner.id, sinceTs);
      if (recent >= PER_USER_PARTNER_DAILY_CAP) {
        req.log.warn(
          { partner: partner.id, recent_count: recent },
          'affiliate click blocked: per-user-partner 24h cap',
        );
        return reply
          .code(429)
          .header('Cache-Control', 'no-store')
          .send({
            error: 'rate_limited',
            reason: 'per_user_partner_24h',
            limit: PER_USER_PARTNER_DAILY_CAP,
            window_seconds: 24 * 3600,
          });
      }
    }

    const ts = ctx.now();
    const rec = ctx.store.insert({
      partner: partner.id,
      surface: q.surface,
      country,
      match_id: q.match_id ?? null,
      team_code: q.team_code ?? null,
      user_id_hash: userIdHash,
      campaign_id: q.campaign_id ?? null,
      ts,
    });

    const redirectUrl = buildRedirectUrl(partner, {
      surface: q.surface,
      match_id: q.match_id,
      team_code: q.team_code,
      campaign_id: q.campaign_id,
    });

    req.log.info(
      {
        click_id: rec.id,
        partner: partner.id,
        surface: q.surface,
        country,
        match_id: q.match_id ?? null,
        team_code: q.team_code ?? null,
        // NEVER log raw user_id — only the hash.
        has_user: Boolean(userIdHash),
      },
      'affiliate click resolved',
    );

    return reply
      .code(302)
      .header('Cache-Control', 'no-store')
      .header('X-VT-Click-Id', rec.id)
      .redirect(redirectUrl);
  });
}
