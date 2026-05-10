/**
 * Discord inbound (Interactions endpoint).
 *
 * Discord sends interaction payloads to a single endpoint. We support
 * the PING handshake (type=1) and the user-installed slash command
 * "/login" or app-DM type=2 events. Discord's signature is Ed25519 over
 * (timestamp || rawBody) using the bot's public key.
 *
 * Note: actual DM delivery uses Bot Gateway events; for the purpose of
 * DM-OTP we treat any interaction message-content equal to the login
 * phrase as a request. A separate gateway-bot worker can be added
 * later (issue #TBD) to listen for plain DM messages and POST them
 * here as a forwarded interaction.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DmOtpContext } from '../../context.js';
import { dispatch } from '../../lib/dispatcher.js';
import { verifyDiscordSignature } from '../../lib/signatures.js';

function rawBodyOf(req: FastifyRequest): string {
  return ((req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}));
}

interface DiscordInteraction {
  type?: number;
  user?: { id?: string };
  member?: { user?: { id?: string } };
  channel_id?: string;
  data?: { name?: string };
  message?: { content?: string };
}

export async function registerDiscordWebhook(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.post('/v1/auth/dm-otp/webhooks/discord', async (req, reply) => {
    const sig = req.headers['x-signature-ed25519'];
    const ts = req.headers['x-signature-timestamp'];
    const ok = verifyDiscordSignature({
      publicKeyHex: ctx.config.discordPublicKey,
      signatureHex: typeof sig === 'string' ? sig : undefined,
      timestamp: typeof ts === 'string' ? ts : undefined,
      rawBody: rawBodyOf(req),
    });
    if (!ok) return reply.code(401).send({ error: 'bad-signature' });

    const interaction = req.body as DiscordInteraction;
    if (interaction.type === 1) {
      // PING -> PONG handshake.
      return reply.code(200).send({ type: 1 });
    }

    const userId = interaction.user?.id ?? interaction.member?.user?.id;
    const text =
      interaction.message?.content ??
      (interaction.data?.name === 'login' ? 'log in' : '');
    const channelId = interaction.channel_id;
    if (typeof userId !== 'string' || typeof text !== 'string') {
      return reply.code(200).send({ type: 4, data: { content: 'Send "log in" to get a code.' } });
    }

    const meta = channelId ? { channelId } : undefined;

    await dispatch(
      {
        store: ctx.store,
        senders: ctx.senders,
        magicLinkChannels: ctx.magicLinkChannels,
        log: ctx.log,
      },
      { channel: 'discord', externalId: userId, text, meta },
    );
    return reply.code(200).send({ type: 4, data: { content: 'Code sent.' } });
  });
}
