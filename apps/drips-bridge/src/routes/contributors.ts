import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAdmin } from './admin.js';

const ROLE_VALUES = ['core', 'agent', 'contributor', 'founder'] as const;

const ethAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'ethAddress must be 0x + 40 hex chars');

const RegisterBody = z.object({
  githubLogin: z.string().min(1).max(64),
  ethAddress: ethAddressSchema.optional(),
  displayName: z.string().min(1).max(120).optional(),
  role: z.enum(ROLE_VALUES).optional(),
  activeShares: z.number().int().nonnegative().optional(),
  upsert: z.boolean().optional(),
});

const PatchBody = z
  .object({
    ethAddress: ethAddressSchema.optional(),
    displayName: z.string().min(1).max(120).optional(),
    role: z.enum(ROLE_VALUES).optional(),
    activeShares: z.number().int().nonnegative().optional(),
  })
  .refine(
    (v) =>
      v.ethAddress !== undefined ||
      v.displayName !== undefined ||
      v.role !== undefined ||
      v.activeShares !== undefined,
    { message: 'patch body must include at least one updatable field' },
  );

export async function registerContributors(app: FastifyInstance, ctx: AppContext) {
  app.post('/v1/contributors', async (req, reply) => {
    if (!requireAdmin(ctx, req, reply)) return;
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parsed.error.issues };
    }
    const { contributor, created } = ctx.contributors.register(parsed.data);
    reply.code(created ? 201 : 200).header('Cache-Control', 'no-store');
    return { contributor, created };
  });

  app.patch('/v1/contributors/:id', async (req, reply) => {
    if (!requireAdmin(ctx, req, reply)) return;
    const id = (req.params as { id: string }).id;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_body', issues: parsed.error.issues };
    }
    const existing = ctx.contributors.get(id);
    if (!existing) {
      reply.code(404);
      return { error: 'not_found', id };
    }
    try {
      const updated = ctx.contributors.update(id, parsed.data);
      reply.header('Cache-Control', 'no-store');
      return { contributor: updated };
    } catch (err) {
      reply.code(400);
      return { error: 'invalid_patch', message: (err as Error).message };
    }
  });

  app.get('/v1/contributors', async (req, reply) => {
    if (!requireAdmin(ctx, req, reply)) return;
    reply.header('Cache-Control', 'no-store');
    return { contributors: ctx.contributors.list() };
  });
}
