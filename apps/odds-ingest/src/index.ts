#!/usr/bin/env node
/**
 * odds-ingest entrypoint. Boots the SQLite store, seeds mock data,
 * starts the HTTP server, then concurrently runs the Polymarket Gamma
 * poller, Polymarket CLOB snapshotter, and (optionally) The Odds API
 * poller. Each loop crash-isolates its own errors.
 */

import { pino } from "pino";

import { buildApp } from "./api.js";
import { ClobSnapshotter } from "./clob-snapshot.js";
import { loadConfig } from "./config.js";
import { loadDataPack } from "./data.js";
import { IngestPoller } from "./poller.js";
import { OddsStore } from "./store/sqlite.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const log = pino({
    level: config.logLevel,
    base: { service: "odds-ingest" },
  });
  log.info({ config: redact(config) }, "starting");

  const store = new OddsStore({ dbPath: config.dbPath });
  const data = loadDataPack();
  log.info({ teams: data.teams.length, fixtures: data.fixtures.length }, "data loaded");

  const poller = new IngestPoller(config, store, data, log);
  const seed = poller.seedMockData();
  log.info(seed, "mock seed complete");

  const app = buildApp({ store, data, poller, log });
  await app.listen({ port: config.port, host: config.bind });
  log.info({ port: config.port, bind: config.bind }, "http server listening");

  const clob = new ClobSnapshotter(config, store, log);
  void clob.run().catch((e) => log.error({ err: e }, "clob snapshotter crashed"));
  void poller.run().catch((e) => log.error({ err: e }, "ingest poller crashed"));

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    poller.stop();
    clob.stop();
    try {
      await app.close();
    } catch (e) {
      log.warn({ err: e }, "error closing http server");
    }
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

function redact(config: ReturnType<typeof loadConfig>): unknown {
  return {
    ...config,
    theOddsApi: {
      ...config.theOddsApi,
      apiKey: config.theOddsApi.apiKey ? "<set>" : null,
    },
  };
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("odds-ingest fatal:", e);
  process.exit(1);
});
