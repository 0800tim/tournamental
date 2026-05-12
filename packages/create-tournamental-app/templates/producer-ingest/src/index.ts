/**
 * __PKG_NAME__
 *
 * Scaffolded producer plugin. Replace `tick()` with your data source.
 * The core hands you an `IngestSubscriber` you call `.push(msg)` on
 * for every message you want to emit. Honour back-pressure via the
 * subscriber's `paused` flag.
 *
 * See:
 *   - examples/hello-producer/ (the script-style reference)
 *   - packages/plugin-sdk/src/index.ts (the IngestPlugin contract)
 *   - docs/58-data-producers.md (auxiliary-stream conventions)
 *   - skills/producer-author/SKILL.md (when + how + boundaries)
 */

import type {
  IngestPlugin,
  IngestSession,
  IngestStartOpts,
  IngestSubscriber,
  MatchInit,
  Message,
  PluginContext,
  StateFrame,
} from "@tournamental/plugin-sdk";

const TICK_HZ = 30;

const plugin: IngestPlugin = {
  label: "__PKG_DISPLAY__",
  id: "__PKG_SLUG__",

  async listAvailableMatches() {
    // Replay-style producers return their static catalogue here.
    // Live feeds return [] and the operator passes match_id via start().
    return [];
  },

  async start(opts: IngestStartOpts, subscriber: IngestSubscriber): Promise<IngestSession> {
    const matchInit: MatchInit = {
      type: "match.init",
      spec_version: "0.1.1",
      match_id: opts.matchId,
      sport: "football",
      field: { length_m: 105, width_m: 68 },
      teams: [
        { code: "HOM", name: "Home XI", colour_primary: "#0a4d8f", colour_secondary: "#fff", kit_id: "default" },
        { code: "AWY", name: "Away XI", colour_primary: "#c41e3a", colour_secondary: "#000", kit_id: "default" },
      ],
      start_time: new Date().toISOString(),
      producer: "__PKG_SLUG__",
    };
    subscriber.push(matchInit);

    let matchClockMs = 0;
    const dtMatchMs = (1000 / TICK_HZ) * (opts.timeScale ?? 1);

    const handle = setInterval(() => {
      if (subscriber.paused) return;
      matchClockMs += dtMatchMs;
      const frame = tick(matchClockMs);
      subscriber.push(frame);
    }, 1000 / TICK_HZ);

    return {
      async dispose() {
        clearInterval(handle);
        subscriber.end();
      },
    };
  },
};

function tick(matchClockMs: number): StateFrame {
  // Replace with your data source. This is the only function most
  // producers need to write. Return a spec-conformant StateFrame.
  return {
    type: "state",
    t: matchClockMs,
    ball: { pos: { x: 0, y: 0.11, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    players: [],
  };
}

export default function factory(_ctx: PluginContext) {
  return { ingestSource: plugin };
}

export { plugin as __PKG_SLUG__Plugin };
