/**
 * GET /v1/auth/dm-otp/start-info?channel=telegram|whatsapp|messenger|instagram
 *
 * Returns the deep-link / web URL for the chosen channel so the website
 * can render a "Tap to log in via X" button (or a QR code on desktop).
 *
 * The website's job: render the link, render the message body the user
 * needs to send ("log in"), and poll for the verify result (the user
 * pastes the 6-digit code into a field once they've received it).
 *
 * No auth on this endpoint — these are public deep-links.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DmOtpContext } from '../context.js';

const ChannelSchema = z.enum(['telegram', 'whatsapp', 'messenger', 'instagram']);

interface ChannelLinkInfo {
  channel: 'telegram' | 'whatsapp' | 'messenger' | 'instagram';
  /** The "tap-to-open in app" URL the user should follow. */
  webUrl: string;
  /** The native app-protocol URL where applicable. */
  appUrl?: string;
  /** The message text we instruct the user to send. */
  prefill: string;
  /** Whether the link can pre-fill the message text on tap. */
  prefillsMessage: boolean;
}

const PREFILL = 'log in';

function telegramLinks(username: string): ChannelLinkInfo {
  // Telegram deep-link: tg://resolve, then HTTPS fallback.
  // `start=login` triggers a deep-link payload the bot can read.
  return {
    channel: 'telegram',
    appUrl: `tg://resolve?domain=${encodeURIComponent(username)}&start=login`,
    webUrl: `https://t.me/${encodeURIComponent(username)}?start=login`,
    prefill: PREFILL,
    // Telegram start-payload is not the same as a chat-prefilled message;
    // the user still has to type "log in" unless the bot's /start handler
    // auto-handles "login". We surface the prefill so the website can
    // show a copy-button.
    prefillsMessage: false,
  };
}

function whatsAppLinks(phone: string): ChannelLinkInfo {
  // wa.me requires no leading +; digits only.
  const num = phone.replace(/\D/g, '');
  return {
    channel: 'whatsapp',
    webUrl: `https://wa.me/${num}?text=${encodeURIComponent(PREFILL)}`,
    prefill: PREFILL,
    prefillsMessage: true,
  };
}

function messengerLinks(pageUsername: string): ChannelLinkInfo {
  // m.me/<username>?ref=login. Messenger shows a "Get Started" tap that
  // posts the ref to the bot via the postback webhook; we can also
  // accept a plain "log in" text from the user.
  return {
    channel: 'messenger',
    webUrl: `https://m.me/${encodeURIComponent(pageUsername)}?ref=login`,
    prefill: PREFILL,
    prefillsMessage: false,
  };
}

function instagramLinks(igUsername: string): ChannelLinkInfo {
  return {
    channel: 'instagram',
    webUrl: `https://ig.me/m/${encodeURIComponent(igUsername)}?ref=login`,
    prefill: PREFILL,
    prefillsMessage: false,
  };
}

export async function registerStartInfo(
  app: FastifyInstance,
  ctx: DmOtpContext,
): Promise<void> {
  app.get('/v1/auth/dm-otp/start-info', async (req, reply) => {
    const q = req.query as Record<string, string | string[] | undefined>;
    const channelRaw = typeof q.channel === 'string' ? q.channel : '';
    const parsed = ChannelSchema.safeParse(channelRaw);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad-channel' });
    }
    const channel = parsed.data;

    let info: ChannelLinkInfo;
    switch (channel) {
      case 'telegram': {
        if (!ctx.config.telegramBotUsername) {
          return reply.code(503).send({ error: 'telegram-not-configured' });
        }
        info = telegramLinks(ctx.config.telegramBotUsername);
        break;
      }
      case 'whatsapp': {
        if (!ctx.config.aivaWaPhone) {
          return reply.code(503).send({ error: 'whatsapp-not-configured' });
        }
        info = whatsAppLinks(ctx.config.aivaWaPhone);
        break;
      }
      case 'messenger': {
        if (!ctx.config.facebookPageUsername) {
          return reply.code(503).send({ error: 'messenger-not-configured' });
        }
        info = messengerLinks(ctx.config.facebookPageUsername);
        break;
      }
      case 'instagram': {
        if (!ctx.config.instagramBusinessUsername) {
          return reply.code(503).send({ error: 'instagram-not-configured' });
        }
        info = instagramLinks(ctx.config.instagramBusinessUsername);
        break;
      }
    }

    reply.header('Cache-Control', 'public, max-age=60, s-maxage=300');
    return reply.code(200).send({
      ok: true,
      ...info,
      ttlSeconds: ctx.store.ttlSeconds(),
    });
  });
}
