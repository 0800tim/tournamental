// Tournament bot entrypoint. Boots Fastify on $PORT (default 3350),
// initialises grammY with the BotFather token, registers the Telegram
// webhook handler, and (when configured) the Aiva WhatsApp webhook so the
// same dispatcher serves both surfaces.
//
// In production, Cloudflare tunnel routes `bot.vtourn.com` to this port.

import Fastify from "fastify";
import { Storage } from "./storage.js";
import { createMainBot } from "./bots/main.js";
import { registerTelegramWebhook } from "./webhooks/telegram.js";
import {
  AivaWhatsAppClient,
  aivaConfigFromEnv,
} from "./whatsapp/aiva-client.js";
import { registerAivaWaWebhook } from "./whatsapp/handler.js";

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    // eslint-disable-next-line no-console
    console.error("TELEGRAM_BOT_TOKEN missing — see .env.example.");
    process.exit(1);
  }
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    // eslint-disable-next-line no-console
    console.error("TELEGRAM_WEBHOOK_SECRET missing — see .env.example.");
    process.exit(1);
  }

  const port = Number.parseInt(process.env.PORT ?? "3350", 10);
  const dbPath = process.env.TG_DB_PATH ?? "./tg.db";

  const storage = new Storage(dbPath);
  const bot = createMainBot(token, { storage });
  await bot.init();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  registerTelegramWebhook(app, { bot, secret });

  // WhatsApp via Aiva gateway is opt-in — only wire it up if the env vars
  // are present. The Telegram path keeps working regardless.
  const aivaCfg = aivaConfigFromEnv();
  const waSecret = process.env.AIVA_WEBHOOK_SECRET ?? "";
  if (aivaCfg && waSecret) {
    const client = new AivaWhatsAppClient(aivaCfg);
    registerAivaWaWebhook(app, { storage, client, secret: waSecret });
    // eslint-disable-next-line no-console
    console.log(
      `aiva-wa webhook registered (session=${aivaCfg.sessionId}, base=${aivaCfg.baseUrl}).`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(
      "aiva-wa webhook disabled (set AIVA_WA_SESSION_ID, AIVA_SMS_API_KEY, AIVA_WEBHOOK_SECRET to enable).",
    );
  }

  app.get("/", async () => ({
    service: "tournament-bot",
    bot_username: bot.botInfo.username,
    whatsapp_enabled: Boolean(aivaCfg && waSecret),
  }));

  app.addHook("onClose", async () => {
    storage.close();
  });

  await app.listen({ port, host: "0.0.0.0" });

  // eslint-disable-next-line no-console
  console.log(
    `tournament-bot listening on :${port}, bot=@${bot.botInfo.username}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
