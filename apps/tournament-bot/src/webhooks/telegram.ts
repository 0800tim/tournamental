// POST /v1/telegram/webhook — feeds raw Telegram update payloads into the
// grammY bot via webhookCallback. Verifies the X-Telegram-Bot-Api-Secret-Token
// header matches what we registered with setWebhook.

import type { Bot } from "grammy";
import { webhookCallback } from "grammy";
import type { FastifyInstance } from "fastify";

export interface TelegramWebhookOpts {
  bot: Bot;
  // Same string we passed to setWebhook(secret_token: ...).
  secret: string;
}

export function registerTelegramWebhook(
  app: FastifyInstance,
  opts: TelegramWebhookOpts,
): void {
  const handle = webhookCallback(opts.bot, "fastify");

  app.post("/v1/telegram/webhook", async (req, reply) => {
    const supplied = req.headers["x-telegram-bot-api-secret-token"];
    if (typeof supplied !== "string" || supplied !== opts.secret) {
      reply.code(401).send({ error: "bad_secret_token" });
      return;
    }
    return handle(req, reply);
  });

  app.get("/v1/telegram/health", async () => {
    return { ok: true, bot: opts.bot.botInfo?.username ?? "unknown" };
  });
}
