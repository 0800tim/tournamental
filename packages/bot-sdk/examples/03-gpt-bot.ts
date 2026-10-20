/**
 * Example 3: GPT-driven bot.
 *
 * Mirror of the Claude example, but using the OpenAI SDK. Sends each match
 * as a structured prompt and asks for a single-token outcome.
 *
 * Run:
 *   OPENAI_API_KEY=sk-xxx \
 *   TOURNAMENTAL_API_KEY=tnm_xxx \
 *   pnpm add openai && pnpm tsx examples/03-gpt-bot.ts
 */

import { Bot, type MatchSpec, type Outcome } from "../src/index.js";

const SAMPLE_MATCHES: MatchSpec[] = [
  {
    id: "wc-2026-m01",
    stage: "group",
    home_code: "BRA",
    away_code: "ARG",
    kickoff_utc: "2026-06-15T20:00:00Z",
  },
];

interface OpenAIClient {
  chat: {
    completions: {
      create: (input: {
        model: string;
        max_tokens: number;
        messages: { role: "user" | "system"; content: string }[];
      }) => Promise<{ choices: { message: { content: string | null } }[] }>;
    };
  };
}

async function askGpt(client: OpenAIClient, match: MatchSpec): Promise<Outcome> {
  const reply = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 8,
    messages: [
      {
        role: "system",
        content:
          "Respond with exactly one token: home_win, draw, or away_win.",
      },
      {
        role: "user",
        content: `${match.home_code ?? "TBD"} vs ${match.away_code ?? "TBD"} (${match.stage}, ${match.kickoff_utc})`,
      },
    ],
  });
  const text = (reply.choices[0]?.message.content ?? "").trim().toLowerCase();
  if (text === "home_win" || text === "draw" || text === "away_win") {
    return text;
  }
  return "draw";
}

async function main(): Promise<void> {
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!apiKey || !process.env.OPENAI_API_KEY) {
    console.error("Set TOURNAMENTAL_API_KEY and OPENAI_API_KEY.");
    process.exit(1);
  }
  // The SDK is an optional peer the reader installs themselves, so it is
  // not in this package's dependencies. A literal specifier makes tsc
  // resolve the module at typecheck time (TS2307 in CI since June 2026);
  // a variable specifier keeps the dynamic import untyped and the catch
  // below still handles the "not installed" case at runtime.
  const sdkModule = "openai";
  const mod = (await import(sdkModule).catch(() => null)) as
    | { default: new (opts: { apiKey: string }) => OpenAIClient }
    | null;
  if (!mod) {
    console.error("Install: pnpm add openai");
    process.exit(1);
  }
  const openai = new mod.default({ apiKey: process.env.OPENAI_API_KEY });
  const bot = new Bot({ apiKey, botId: "example-gpt-01" });
  for (const match of SAMPLE_MATCHES) {
    bot.pick(match.id, await askGpt(openai, match));
  }
  const res = await bot.flush();
  console.log(`GPT bot submitted: accepted=${res.accepted}`);
}

if (process.argv[1] && process.argv[1].endsWith("03-gpt-bot.ts")) {
  void main();
}

export { askGpt };
