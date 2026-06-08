/**
 * Example 5: Polymarket arbitrage.
 *
 * Reads Polymarket's public CLOB API for World Cup match prices, converts
 * them to implied probabilities, then submits the chalk pick. Polymarket
 * prices on liquid markets are usually a fairer reflection of consensus
 * than bookmaker odds (no vig).
 *
 * Production code should cache + rate-limit. This example does the
 * minimum required to demonstrate the integration.
 *
 * Run:
 *   TOURNAMENTAL_API_KEY=tnm_xxx pnpm tsx examples/05-polymarket-arb.ts
 */

import { Bot, type Outcome } from "../src/index.js";

interface PolymarketBook {
  match_id: string;
  question: string;
  yes_price: number;
  no_price: number;
}

const POLYMARKET_BASE = "https://gamma-api.polymarket.com";

async function fetchOpenWcMatches(
  fetcher: typeof fetch = fetch,
): Promise<PolymarketBook[]> {
  const url = `${POLYMARKET_BASE}/markets?closed=false&tag=world-cup-2026`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`Polymarket HTTP ${res.status}`);
  const json = (await res.json()) as {
    markets: {
      id: string;
      question: string;
      outcomes: { name: string; price: number }[];
    }[];
  };
  return (json.markets ?? []).map((m) => {
    const yes = m.outcomes.find((o) => o.name.toLowerCase() === "yes");
    const no = m.outcomes.find((o) => o.name.toLowerCase() === "no");
    return {
      match_id: m.id,
      question: m.question,
      yes_price: yes?.price ?? 0.5,
      no_price: no?.price ?? 0.5,
    };
  });
}

function pickFromBook(book: PolymarketBook): Outcome {
  if (book.yes_price >= 0.55) return "home_win";
  if (book.no_price >= 0.55) return "away_win";
  return "draw";
}

async function main(): Promise<void> {
  const apiKey = process.env.TOURNAMENTAL_API_KEY;
  if (!apiKey) {
    console.error("Set TOURNAMENTAL_API_KEY to run this example.");
    process.exit(1);
  }
  const books = await fetchOpenWcMatches();
  const bot = new Bot({ apiKey, botId: "example-polymarket-01" });
  for (const book of books) bot.pick(book.match_id, pickFromBook(book));
  const res = await bot.flush();
  console.log(
    `polymarket-arb bot submitted: matches=${books.length} accepted=${res.accepted}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("05-polymarket-arb.ts")) {
  void main();
}

export { fetchOpenWcMatches, pickFromBook };
