/**
 * GET /v1/affiliate/partners?country=NZ
 *
 * Returns the partner list available in the resolved country, with the public
 * fields a frontend needs to render an `<AffiliateCTA>` (display name, logo,
 * offer text). Affiliate codes are NEVER returned.
 *
 * Country resolves from `cf-ipcountry` first, then `?country=`.
 *
 * 422 if country can't be resolved.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AppContext } from '../context.js';
import { resolveCountryFromReq } from '../geo.js';

const QuerySchema = z.object({
  country: z.string().optional(),
});

export async function registerPartners(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/affiliate/partners', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .header('Cache-Control', 'no-store')
        .send({ error: 'invalid_params' });
    }

    const country = resolveCountryFromReq(req);
    if (!country) {
      return reply
        .code(422)
        .header('Cache-Control', 'no-store')
        .send({ error: 'country_unresolved' });
    }

    const partners = ctx.registry.forCountry(country).map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      offer_text: p.offer_text,
      logo_url: p.logo_url,
    }));

    // Per docs/22 caching matrix: short edge cache for list aggregates.
    return reply
      .header(
        'Cache-Control',
        'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
      )
      .send({ country, partners });
  });
}
