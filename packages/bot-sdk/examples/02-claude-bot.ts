/**
 * Example 2: Claude-driven bot.
 *
 * Sends a structured prompt to claude-opus-4-7 for each match and parses a
 * single-token JSON response. Bring your own ANTHROPIC_API_KEY. The
 * Anthropic SDK is loaded dynamically so this example type-checks without
 * the dependency installed.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-xxx \
 *   TOURNAMENTAL_API_KEY=tnm_xxx \
 *   pnpm add @anthropic-ai/sdk && pnpm tsx examples/02-claude-bot.ts
 */

import { Bot, type MatchSpec, type Outcome } from "../src/index.js";

const SAMPLE_MATCHES: MatchSpec[] = [
  {
    id: "wc-2026-m01",
    stage: "group",
    home_code: "USA",
    away_code: "MEX",
    kickoff_utc: "2026-06-11T20:00:00Z",
  },
  {
    id: "wc-2026-m02",
    stage: "group",
    home_code: "ENG",
    away_code: "SCO",
    kickoff_utc: "2026-06-12T18:00:00Z",
  },
];

interface ClaudeClient {
  messages: {
    create: (input: {
      model: string;
      max_tokens: number;
      messages: { role: "user"; content: string }[];
    }) => Promise<{ content: { type: string; text: string }[] }>;
  };
}

async function askClaude(client: ClaudeClient, match: MatchSpec): Promise<Outcome> {
  const prompt = `You are a football analyst. Predict the outcome of this match.
Respond ONLY with one of these tokens: home_win, draw, away_win.

Match: ${match.home_code ?? "TBD"} vs ${match.away_code ?? "TBD"}
Stage: ${match.stage}
Kickoff: ${match.kickoff_utc}`;
  const reply = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 16,
    messages: [{ role: "user", content: prompt }],
  });
  const text = reply.content.find((c) => c.type === "text")?.text ?? "";
  const token = text.trim().toLowerCase();
  if (token === "home_win" || token === "draw" || token === "away_win") {
    return token;
  }
  return "draw";
}

async function main(): Promise<void> {
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!apiKey || !process.env.ANTHROPIC_API_KEY) {
    console.error("Set TOURNAMENTAL_API_KEY and ANTHROPIC_API_KEY.");
    process.exit(1);
  }
  const mod = (await import("@anthropic-ai/sdk").catch(() => null)) as
    | { default: new (opts: { apiKey: string }) => ClaudeClient }
    | null;
  if (!mod) {
    console.error("Install: pnpm add @anthropic-ai/sdk");
    process.exit(1);
  }
  const claude = new mod.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  const bot = new Bot({ apiKey, botId: "example-claude-01" });
  for (const match of SAMPLE_MATCHES) {
    const outcome = await askClaude(claude, match);
    bot.pick(match.id, outcome);
  }
  const res = await bot.flush();
  console.log(`Claude bot submitted: accepted=${res.accepted}`);
}

if (process.argv[1] && process.argv[1].endsWith("02-claude-bot.ts")) {
  void main();
}

export { askClaude };
