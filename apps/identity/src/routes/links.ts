/**
 * Link routes:
 *   POST /v1/links/start       — return mock OAuth URL for a provider
 *   POST /v1/links/callback    — record the link
 *   GET  /v1/users/:userId/links — list a user's linked providers
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { IdentityContext } from '../context.js';
import { providers, PROVIDER_IDS, type ProviderId } from '../lib/providers/index.js';
import { mintState } from '../lib/state.js';

const ProviderEnum = z.enum(PROVIDER_IDS as [ProviderId, ...ProviderId[]]);

const startSchema = z.object({
  userId: z.string().min(1),
  provider: ProviderEnum,
});

const callbackSchema = z.object({
  userId: z.string().min(1),
  provider: ProviderEnum,
  externalId: z.string().min(1),
  profile: z
    .object({
      displayName: z.string().optional(),
      email: z.string().email().optional(),
      avatarUrl: z.string().url().optional(),
      accountCreatedAt: z.number().optional(),
      telegramPremium: z.boolean().optional(),
      verified: z.boolean().optional(),
      raw: z.record(z.unknown()).optional(),
    })
    .partial()
    .optional(),
});

export async function registerLinks(
  app: FastifyInstance,
  ctx: IdentityContext,
): Promise<void> {
  app.post('/v1/links/start', async (req, reply) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', details: parsed.error.flatten() };
    }
    const { userId, provider } = parsed.data;
    const adapter = providers[provider];
    const state = mintState();
    const redirectUri = `${ctx.config.publicBaseUrl}/v1/links/callback/${provider}`;
    const result = adapter.startLink({ userId, state, redirectUri });
    reply.header('Cache-Control', 'no-store');
    return {
      provider,
      authorizeUrl: result.authorizeUrl,
      expectedScopes: result.expectedScopes,
      state,
      mock: true,
    };
  });

  app.post('/v1/links/callback', async (req, reply) => {
    const parsed = callbackSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', details: parsed.error.flatten() };
    }
    const { userId, provider, externalId, profile } = parsed.data;
    const adapter = providers[provider];
    const resolved = await adapter.resolveCallback({ externalId, profile });
    const now = ctx.now();
    const rec = ctx.storage.upsertLink({
      userId,
      provider,
      externalId: resolved.externalId,
      linkedAt: now,
      lastSeenAt: now,
      profile: resolved,
    });
    reply.header('Cache-Control', 'no-store');
    return { ok: true, link: rec };
  });

  app.get<{ Params: { userId: string } }>(
    '/v1/users/:userId/links',
    async (req, reply) => {
      const links = ctx.storage.listLinks(req.params.userId);
      reply.header('Cache-Control', 'private, no-store');
      return {
        userId: req.params.userId,
        count: links.length,
        links: links.map((l) => ({
          provider: l.provider,
          externalId: l.externalId,
          linkedAt: l.linkedAt,
          lastSeenAt: l.lastSeenAt,
          displayName: l.profile?.displayName,
        })),
      };
    },
  );
}
