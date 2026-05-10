// Test helpers: spin up a grammY bot wired to an in-memory Storage, capture
// outgoing Telegram API calls via a fake transformer (we don't talk to
// Telegram in tests).

import type { Bot, RawApi } from "grammy";
import type { Update } from "grammy/types";
import { createMainBot } from "../src/bots/main.js";
import { Storage } from "../src/storage.js";

export interface CapturedCall {
  method: keyof RawApi;
  payload: Record<string, unknown>;
}

export interface TestBotHarness {
  bot: Bot;
  storage: Storage;
  calls: CapturedCall[];
  feed: (update: Partial<Update>) => Promise<void>;
}

let updateCounter = 1;

export function makeHarness(): TestBotHarness {
  const storage = new Storage(":memory:");
  const bot = createMainBot("0:test-token", { storage });
  const calls: CapturedCall[] = [];

  // Stamp botInfo so grammY skips the getMe roundtrip.
  bot.botInfo = {
    id: 1,
    is_bot: true,
    first_name: "Tournamental",
    username: "TournamentalBot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as Bot["botInfo"];

  // Capture outbound API calls; return a permissive fake response.
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: { ...(payload as object) } });
    // Minimal Message-like return; grammY treats as opaque.
    return {
      ok: true,
      result: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: (payload as { chat_id?: number }).chat_id ?? 0, type: "private" },
        text: (payload as { text?: string }).text ?? "",
      },
    } as never;
  });

  return {
    bot,
    storage,
    calls,
    feed: async (update) => {
      const wrapped: Update = {
        ...(update as Update),
        update_id: updateCounter++,
      };
      await bot.handleUpdate(wrapped);
    },
  };
}

export function makeMessageUpdate(opts: {
  chat_id: number;
  text: string;
  user_id?: number;
  username?: string;
  language_code?: string;
}): Partial<Update> {
  return {
    message: {
      message_id: Math.floor(Math.random() * 1_000_000),
      date: Math.floor(Date.now() / 1000),
      chat: { id: opts.chat_id, type: "private" },
      from: {
        id: opts.user_id ?? opts.chat_id,
        is_bot: false,
        first_name: "Test",
        username: opts.username ?? "test_user",
        language_code: opts.language_code ?? "en",
      },
      text: opts.text,
      entities: opts.text.startsWith("/")
        ? [
            {
              type: "bot_command",
              offset: 0,
              length: opts.text.split(/\s/)[0].length,
            },
          ]
        : undefined,
    },
  } as Partial<Update>;
}

export function lastReply(calls: CapturedCall[]): string {
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i].method === "sendMessage") {
      return String(calls[i].payload.text ?? "");
    }
  }
  return "";
}
