#!/usr/bin/env node
/**
 * mock-producer CLI.
 *
 * Mirrors the StatsBomb-replay producer's CLI shape so the renderer code
 * is identical for both.
 */
import { Command, Option } from "commander";
import { runSimulation } from "./simulation.js";
import { defaultTeams, loadTeamsFromPath } from "./teams.js";
import {
  type Emitter,
  FileEmitter,
  SseEmitter,
  StdoutEmitter,
  WebSocketEmitter,
} from "./emitter.js";

interface CliOpts {
  seed: string;
  matchDurationMs: number;
  timeScale: number;
  out: "ws" | "sse" | "file" | "stdout";
  port: number;
  path: string;
  teams?: string;
}

async function main(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("mock-producer")
    .description("VTourn synthetic match generator (renderer dev fixture)")
    .option("--seed <value>", "deterministic RNG seed", "42")
    .option("--match-duration-ms <ms>", "match duration in ms", (v) => parseInt(v, 10), 5_400_000)
    .option("--time-scale <factor>", "wall-clock pace multiplier (1=real time, 10=10x)", (v) => parseFloat(v), 1)
    .addOption(
      new Option("--out <mode>", "output mode")
        .choices(["ws", "sse", "file", "stdout"])
        .default("stdout"),
    )
    .option("--port <number>", "TCP port for ws/sse modes", (v) => parseInt(v, 10), 4001)
    .option("--path <value>", "for file: out dir; for ws/sse: URL path", "./out")
    .option("--teams <path>", "optional path to JSON with custom rosters")
    .parse(argv);

  const opts = program.opts<CliOpts>();

  const teams = opts.teams ? await loadTeamsFromPath(opts.teams) : defaultTeams();
  const seedNumeric = Number(opts.seed);
  const seed = Number.isFinite(seedNumeric) ? seedNumeric : opts.seed;

  const result = runSimulation({
    seed,
    matchDurationMs: opts.matchDurationMs,
    teams,
  });

  const ctx = {
    init: result.init,
    messages: result.messages,
    timeScale: opts.timeScale,
  };

  let emitter: Emitter;
  switch (opts.out) {
    case "stdout":
      emitter = new StdoutEmitter(ctx);
      break;
    case "file":
      emitter = new FileEmitter(ctx, { outDir: opts.path });
      break;
    case "ws":
      emitter = new WebSocketEmitter(ctx, {
        port: opts.port,
        // For ws, --path defaults to "./out"; only honour it as a URL path
        // if the user supplied something starting with "/".
        path: opts.path && opts.path.startsWith("/") ? opts.path : undefined,
      });
      break;
    case "sse":
      emitter = new SseEmitter(ctx, {
        port: opts.port,
        path: opts.path && opts.path.startsWith("/") ? opts.path : "/stream",
      });
      break;
    default:
      throw new Error(`Unknown --out mode: ${String(opts.out)}`);
  }

  await emitter.run();
}

main(process.argv).catch((err) => {
  process.stderr.write(`mock-producer: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
