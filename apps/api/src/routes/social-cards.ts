/**
 * Social cards route — DYNAMIC OG / share card endpoint.
 *
 * STATUS: skeleton only. The runtime registration belongs in
 *         `apps/api/src/server.ts` which the API agent owns
 *         (`feat/api-shell`). This file is intentionally a *new file*
 *         under `routes/` so it can be wired without conflict the
 *         moment `feat/api-shell` and `feat/social-distribution-kit`
 *         both land on `main`.
 *
 * URL pattern (proposed):
 *
 *   GET /v1/cards/{kind}/{id}.{png|svg}
 *
 * Where:
 *   - `kind`        — one of `bracket-prediction | goal-clip | match-result |
 *                     leaderboard-rank | badge-earned | referral-invite |
 *                     tournament-recap` (from `@tournamental/social-cards`).
 *   - `id`          — opaque resolution key. The route looks up the input
 *                     payload via the per-kind resolver:
 *                        - `goal-clip/{event_id}`        → spec event
 *                        - `match-result/{match_id}`     → match summary
 *                        - `leaderboard-rank/{user_id}`  → leaderboard read
 *                        - `bracket-prediction/{lock_id}`→ bracket read
 *                        - `badge-earned/{award_id}`     → badges_awarded row
 *                        - `referral-invite/{user_id}`   → user record
 *                        - `tournament-recap/{user_id}_{tournament_id}`
 *   - `.png|.svg`   — output format. PNG is the default; SVG is for
 *                     pre-prod debugging only (it can leak handle text
 *                     unredacted to scrapers).
 *
 * Caching:
 *   - PNG responses set `Cache-Control: public, max-age=86400, immutable`
 *     and use a strong ETag of `kind:id:dataVersion`.
 *   - The CDN tier (Cloudflare in front of api.tournamental.com, per
 *     `docs/22`) is what actually serves > 99% of traffic; this route
 *     is the cache-fill source.
 *
 * Auth:
 *   - The endpoint is public (cards must be embeddable in the OG meta of
 *     pages that aren't authenticated). PII leakage is bounded by:
 *       a) the card never displays raw email / phone — only the user's
 *          handle + opaque user id.
 *       b) for kinds keyed by `user_id`, the resolver checks the user's
 *          `share_to_brand_channel` flag where applicable, and substitutes
 *          a generic "Tournamental" handle if not set.
 *
 * Rate limit:
 *   - 60 req/min per IP (the global limiter from server.ts is fine).
 *   - The cache-fill path is internal-only after the CDN warms — IP
 *     rate-limit hits in production should be near-zero.
 *
 * Implementation sketch (PSEUDOCODE — the API agent fills this in):
 *
 *   import type { FastifyInstance } from 'fastify';
 *   import { generateOG, type CardKind } from '@tournamental/social-cards';
 *
 *   export async function registerSocialCards(app: FastifyInstance) {
 *     app.get<{
 *       Params: { kind: CardKind; idAndExt: string };
 *     }>('/v1/cards/:kind/:idAndExt', async (req, reply) => {
 *       const { kind, idAndExt } = req.params;
 *       const m = /^(.+)\.(png|svg)$/.exec(idAndExt);
 *       if (!m) return reply.code(400).send({ error: 'bad-extension' });
 *       const [, id, ext] = m;
 *       const input = await resolveCardInput(kind, id);  // implemented per kind
 *       if (!input) return reply.code(404).send({ error: 'not-found' });
 *       const { og } = await generateOG(input);
 *       reply
 *         .header('Cache-Control', 'public, max-age=86400, immutable')
 *         .header('ETag', `"${kind}:${id}:${input.__version ?? 'v1'}"`)
 *         .type(ext === 'png' ? 'image/png' : 'image/svg+xml')
 *         .send(ext === 'png' ? Buffer.from(og.png) : og.svg);
 *     });
 *   }
 *
 *   // resolveCardInput(kind, id) is the per-kind data-loader that the
 *   // events/badges/leaderboard schemas will provide. Spec lives in
 *   // docs/24 § Surfaces and docs/27 § Performance tracking.
 *
 * Mounting:
 *   In server.ts, after the existing `await registerVersion(app)`:
 *
 *     import { registerSocialCards } from './routes/social-cards.js';
 *     await registerSocialCards(app);
 *
 * Tests (where they go when the route is real):
 *   - `apps/api/test/routes/social-cards.test.ts`:
 *     a) GET an unknown kind → 400.
 *     b) GET a known kind + unknown id → 404.
 *     c) GET a known kind + valid id, .png → 200, image/png, body length > 0.
 *     d) GET same as (c), .svg → 200, image/svg+xml, body starts with <svg.
 *     e) Cache-Control + ETag headers asserted.
 *     f) PII assertion: response body must not contain the user's email or
 *        any internal id formats (`u_*` is fine; `usr_*` raw uuids are not).
 */

export const SOCIAL_CARDS_ROUTE_VERSION = "0.1.0-stub";

/**
 * Placeholder export so anyone TypeScript-importing this file at
 * compile time gets a clear "not yet wired" type.
 */
export type SocialCardsRouteStatus = "stub-only";
