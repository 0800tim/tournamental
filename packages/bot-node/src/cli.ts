/**
 * Tournamental bot-node CLI.
 *
 * Usage:
 *   tournamental-bot-node register --email=you@x.com [--label=swarm-01]
 *   tournamental-bot-node generate --bots=100000 [--strategy=chalk] [--seed=...]
 *   tournamental-bot-node commit   [--dry-run]
 *   tournamental-bot-node score    --match-id=... --outcome=home_win [--dry-run]
 *   tournamental-bot-node serve    [--port=4080]
 *
 * Shortcut:
 *   tournamental-bot-node --bots=100 --strategy=chalk --dry-run
 *     register-if-needed + generate + commit-dry-run, prints summary.
 *
 * Environment:
 *   TOURNAMENTAL_NODE_DB        Path to SQLite db. Default ./data/bot-node.db
 *   TOURNAMENTAL_CENTRAL_URL    Central server base URL. Default
 *                               https://api.tournamental.com
 *   TOURNAMENTAL_MATCHES        Optional path to a JSON file of MatchSpec[]
 *                               for offline / demo runs. If unset and the
 *                               central server is unreachable, a tiny demo
 *                               catalogue is used so the CLI is always
 *                               runnable from a fresh clone.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { CentralClient } from "./central.js";
import { generateBots } from "./generator.js";
import { commitMatch, pendingMatches } from "./scheduler.js";
import { scoreMatch } from "./scorer.js";
import { Storage } from "./storage.js";
import { chalkStrategy } from "./strategy/chalk.js";
import { registerNode } from "./registration.js";
import type { MatchSpec, Outcome } from "./types.js";

const DEFAULT_DB = process.env.TOURNAMENTAL_NODE_DB ?? "./data/bot-node.db";
const DEFAULT_CENTRAL_URL =
  process.env.TOURNAMENTAL_CENTRAL_URL ?? "https://api.tournamental.com";

const DEMO_MATCHES: MatchSpec[] = [
  {
    match_id: "demo-1",
    tournament_id: "fifa-wc-2026-demo",
    home_team: "Argentina",
    away_team: "France",
    kickoff_utc: futureIso(60),
    allows_draw: true,
    odds: { home_win: 0.42, draw: 0.27, away_win: 0.31 },
  },
  {
    match_id: "demo-2",
    tournament_id: "fifa-wc-2026-demo",
    home_team: "Brazil",
    away_team: "Germany",
    kickoff_utc: futureIso(90),
    allows_draw: true,
    odds: { home_win: 0.5, draw: 0.25, away_win: 0.25 },
  },
  {
    match_id: "demo-3",
    tournament_id: "fifa-wc-2026-demo",
    home_team: "England",
    away_team: "Netherlands",
    kickoff_utc: futureIso(120),
    allows_draw: false,
    odds: { home_win: 0.55, draw: 0, away_win: 0.45 },
  },
];

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

interface ParsedArgs {
  command: string;
  values: Record<string, string | boolean | undefined>;
}

function parse(argv: string[]): ParsedArgs {
  const positional = argv[0] && !argv[0].startsWith("--") ? argv[0] : "";
  const rest = positional ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args: rest,
    allowPositionals: false,
    strict: false,
    options: {
      bots: { type: "string" },
      strategy: { type: "string" },
      seed: { type: "string" },
      email: { type: "string" },
      label: { type: "string" },
      "central-url": { type: "string" },
      "match-id": { type: "string" },
      outcome: { type: "string" },
      "dry-run": { type: "boolean" },
      port: { type: "string" },
      host: { type: "string" },
      db: { type: "string" },
      help: { type: "boolean" },
      matches: { type: "string" },
    },
  });
  const command = positional || inferCommand(values);
  return { command, values };
}

function inferCommand(v: Record<string, unknown>): string {
  if (v.bots) return "generate-and-commit";
  if (v.email) return "register";
  return "help";
}

function loadMatches(values: Record<string, string | boolean | undefined>): MatchSpec[] {
  const explicit = typeof values.matches === "string" ? values.matches : process.env.TOURNAMENTAL_MATCHES;
  if (explicit) {
    const text = readFileSync(resolve(explicit), "utf8");
    return JSON.parse(text) as MatchSpec[];
  }
  return DEMO_MATCHES;
}

function openStorage(values: Record<string, string | boolean | undefined>): Storage {
  const path = typeof values.db === "string" ? values.db : DEFAULT_DB;
  return new Storage({ path });
}

const HELP = `tournamental-bot-node - federated Tournamental bot node

Commands:
  register --email=<addr> [--label=<l>] [--central-url=<u>]
    One-time: register with the central server and store credentials.

  generate --bots=<n> [--strategy=chalk] [--seed=<hex>]
    Materialise N bots locally and lock in picks for every upcoming match.

  commit [--dry-run]
    Build merkle roots for every uncommitted upcoming match and push them to
    the central server before kickoff. --dry-run skips the network call.

  score --match-id=<id> --outcome=<home_win|draw|away_win> [--dry-run]
    Score local bots against a resolved match and POST the aggregate.

  serve [--port=4080] [--host=0.0.0.0]
    Start the HTTP server (/health, /stats, merkle-proof endpoint).

Shortcut:
  tournamental-bot-node --bots=100 --strategy=chalk --dry-run
    Generate + commit (dry) in one go. Used for smoke tests and demos.

Environment:
  TOURNAMENTAL_NODE_DB        SQLite path. Default ./data/bot-node.db
  TOURNAMENTAL_CENTRAL_URL    Central API base. Default ${DEFAULT_CENTRAL_URL}
  TOURNAMENTAL_MATCHES        Path to a MatchSpec[] JSON file for offline use.
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { command, values } = parse(argv);
  if (values.help || command === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  const storage = openStorage(values);
  try {
    switch (command) {
      case "register":
        return await runRegister(storage, values);
      case "generate":
        return runGenerate(storage, values);
      case "commit":
        return await runCommit(storage, values);
      case "score":
        return await runScore(storage, values);
      case "serve":
        return await runServe(storage, values);
      case "generate-and-commit":
        return await runGenerateAndCommit(storage, values);
      default:
        process.stdout.write(HELP);
        return 1;
    }
  } finally {
    storage.close();
  }
}

async function runRegister(
  storage: Storage,
  values: Record<string, string | boolean | undefined>,
): Promise<number> {
  const email = String(values.email ?? "");
  if (!email) {
    process.stderr.write("register: --email is required\n");
    return 2;
  }
  const central_base_url =
    typeof values["central-url"] === "string"
      ? values["central-url"]
      : DEFAULT_CENTRAL_URL;
  const label = typeof values.label === "string" ? values.label : undefined;
  const creds = await registerNode({
    storage,
    central_base_url,
    operator_email: email,
    label,
  });
  process.stdout.write(
    `registered node ${creds.node_id} for ${creds.operator_email}\n` +
      `central: ${creds.central_base_url}\n`,
  );
  return 0;
}

function runGenerate(
  storage: Storage,
  values: Record<string, string | boolean | undefined>,
): number {
  const count = Number(values.bots ?? "0");
  if (!Number.isFinite(count) || count <= 0) {
    process.stderr.write("generate: --bots=<n> required\n");
    return 2;
  }
  const matches = loadMatches(values);
  const seed = typeof values.seed === "string" ? values.seed : undefined;
  const result = generateBots(storage, matches, {
    count,
    seed,
    strategy: chalkStrategy,
    onProgress: (done, total) => {
      if (done % 25_000 === 0 || done === total) {
        process.stdout.write(`  generated ${done}/${total} bots\n`);
      }
    },
  });
  process.stdout.write(
    `generated ${result.bots_generated} new bots ` +
      `(swarm total: ${result.total_bots_after}), ` +
      `${result.picks_generated} picks hashed in ${result.elapsed_ms}ms\n`,
  );
  return 0;
}

async function runCommit(
  storage: Storage,
  values: Record<string, string | boolean | undefined>,
): Promise<number> {
  const dryRun = Boolean(values["dry-run"]);
  const matches = loadMatches(values);
  const pending = pendingMatches(matches, storage);
  const upcoming = pending.filter((p) => p.reason === "upcoming");

  if (pending.some((p) => p.reason === "missed")) {
    const missed = pending.filter((p) => p.reason === "missed").map((p) => p.match.match_id);
    process.stderr.write(
      `warning: skipping ${missed.length} matches past kickoff: ${missed.join(", ")}\n`,
    );
  }

  if (upcoming.length === 0) {
    process.stdout.write("no upcoming matches to commit\n");
    return 0;
  }

  const central = dryRun ? undefined : centralClient(storage);
  const creds = storage.loadCredentials();
  for (const item of upcoming) {
    const res = await commitMatch({
      storage,
      match: item.match,
      dry_run: dryRun,
      central,
      node_id: creds?.node_id,
    });
    process.stdout.write(
      `commit ${res.match_id} root=${res.merkle_root.slice(0, 16)}... ` +
        `bots=${res.bot_count} ` +
        (res.pushed_to_central ? "pushed" : "(dry-run)") +
        "\n",
    );
  }
  return 0;
}

async function runScore(
  storage: Storage,
  values: Record<string, string | boolean | undefined>,
): Promise<number> {
  const match_id = String(values["match-id"] ?? "");
  const outcome = String(values.outcome ?? "") as Outcome;
  const dryRun = Boolean(values["dry-run"]);
  if (!match_id || !outcome) {
    process.stderr.write("score: --match-id and --outcome required\n");
    return 2;
  }
  if (!["home_win", "draw", "away_win"].includes(outcome)) {
    process.stderr.write("score: --outcome must be home_win|draw|away_win\n");
    return 2;
  }
  const central = dryRun ? undefined : centralClient(storage);
  const creds = storage.loadCredentials();
  // v0.3.0: scoreMatch regenerates picks on demand, so it needs the
  // match catalogue to know the home/away/odds/allows_draw for the
  // settled match plus every other settled match (to walk the
  // still-perfect set).
  const matches = loadMatches(values);
  const summary = await scoreMatch({
    storage,
    matches,
    result: {
      match_id,
      outcome,
      resolved_at_utc: new Date().toISOString(),
    },
    dry_run: dryRun,
    central,
    node_id: creds?.node_id,
  });
  process.stdout.write(
    `scored ${summary.match_id}: ${summary.bots_correct}/${summary.total_bots} correct, ` +
      `${summary.bots_still_perfect} still perfect, top ${summary.top_n} reported\n`,
  );
  return 0;
}

async function runServe(
  storage: Storage,
  values: Record<string, string | boolean | undefined>,
): Promise<number> {
  const { createServer } = await import("./server.js");
  const port = Number(values.port ?? process.env.PORT ?? 4080);
  const host = typeof values.host === "string" ? values.host : process.env.HOST ?? "0.0.0.0";
  const srv = createServer({ storage, port, host });
  const addr = await srv.start();
  process.stdout.write(`bot-node listening on ${addr}\n`);
  return new Promise<number>((res) => {
    const shutdown = async () => {
      await srv.stop();
      res(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

async function runGenerateAndCommit(
  storage: Storage,
  values: Record<string, string | boolean | undefined>,
): Promise<number> {
  // Convenience for `--bots=100 --dry-run`. Always dry-run unless the operator
  // explicitly passes --dry-run=false; we avoid touching the network from a
  // bare shortcut invocation.
  const explicit = "dry-run" in values;
  const dryRun = explicit ? Boolean(values["dry-run"]) : true;
  const gen = runGenerate(storage, values);
  if (gen !== 0) return gen;
  return runCommit(storage, { ...values, "dry-run": dryRun });
}

function centralClient(storage: Storage): CentralClient {
  const creds = storage.loadCredentials();
  if (!creds) {
    throw new Error(
      "no credentials on file; run `tournamental-bot-node register --email=...` first",
    );
  }
  return CentralClient.fromCredentials(creds);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
