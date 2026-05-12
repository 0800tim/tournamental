#!/usr/bin/env node
// hello-producer — minimum-viable WebSocket producer for the
// @tournamental/spec stream. Emits a synthetic 90-minute match
// at 30Hz with a handful of event messages. ~200 lines, one dep.
//
// Usage:
//   node src/index.mjs                  # listens on ws://localhost:4001/
//   PORT=5050 node src/index.mjs        # listen on a different port
//
// Apache 2.0.

import { WebSocketServer } from "ws";

const PORT = parseInt(process.env.PORT ?? "4001", 10);
const MATCH_ID = process.env.MATCH_ID ?? "hello-producer-demo";
const TICK_HZ = 30;
const TIME_SCALE = parseFloat(process.env.TIME_SCALE ?? "10"); // 10x = 9 min instead of 90
const MATCH_DURATION_MS = 90 * 60 * 1000;

const log = (...m) => console.log("[hello-producer]", ...m);

// ---------- spec-shaped messages ----------

const MATCH_INIT = {
  type: "match.init",
  spec_version: "0.1.1",
  match_id: MATCH_ID,
  sport: "football",
  field: { length_m: 105, width_m: 68 },
  teams: [
    {
      code: "HOM",
      name: "Home XI",
      colour_primary: "#0a4d8f",
      colour_secondary: "#ffffff",
      kit_id: "home-default",
    },
    {
      code: "AWY",
      name: "Away XI",
      colour_primary: "#c41e3a",
      colour_secondary: "#000000",
      kit_id: "away-default",
    },
  ],
  start_time: new Date().toISOString(),
  venue: "Hello Producer Stadium",
  competition: "Hello Producer Friendly",
  producer: "hello-producer-v0.0.1",
};

// 11 + 11 players. Just give them ids; the renderer will route
// them through the avatar/kit pipeline.
function initialPlayers() {
  const out = [];
  for (let i = 0; i < 11; i++) {
    out.push({
      id: `HOM-${i + 1}`,
      team: "HOM",
      pos: { x: -10 - i * 0.5, y: 0, z: (i - 5) * 4 },
      vel: { x: 0, y: 0, z: 0 },
      anim: i === 0 ? "idle_keeper" : "idle",
    });
  }
  for (let i = 0; i < 11; i++) {
    out.push({
      id: `AWY-${i + 1}`,
      team: "AWY",
      pos: { x: 10 + i * 0.5, y: 0, z: (i - 5) * 4 },
      vel: { x: 0, y: 0, z: 0 },
      anim: i === 0 ? "idle_keeper" : "idle",
    });
  }
  return out;
}

// Pre-script a handful of events so the demo isn't silent.
// Each entry: matchTimeMs, then a function returning an EventMessage
// (and optionally a side-effect on state). Sorted ascending.
const SCRIPTED_EVENTS = [
  {
    atMs: 0,
    make: () => ({ type: "event.period_start", period: 1, t: 0 }),
  },
  {
    atMs: 0,
    make: () => ({ type: "event.kickoff", team: "HOM", t: 0 }),
  },
  {
    atMs: 12 * 60 * 1000,
    make: (s) => {
      s.score.home = 1;
      return [
        { type: "event.shot", player: "HOM-9", target: { x: 52.5, y: 1, z: 0 }, on_target: true, t: 12 * 60 * 1000 },
        { type: "event.goal", player: "HOM-9", team: "HOM", t: 12 * 60 * 1000 },
        { type: "event.score_change", home: 1, away: 0, t: 12 * 60 * 1000 },
      ];
    },
  },
  {
    atMs: 38 * 60 * 1000,
    make: (s) => {
      s.score.away = 1;
      return [
        { type: "event.shot", player: "AWY-9", target: { x: -52.5, y: 1.4, z: 0 }, on_target: true, t: 38 * 60 * 1000 },
        { type: "event.goal", player: "AWY-9", team: "AWY", t: 38 * 60 * 1000 },
        { type: "event.score_change", home: 1, away: 1, t: 38 * 60 * 1000 },
      ];
    },
  },
  {
    atMs: 45 * 60 * 1000,
    make: () => ({ type: "event.period_end", period: 1, t: 45 * 60 * 1000 }),
  },
  {
    atMs: 45 * 60 * 1000 + 100,
    make: () => ({ type: "event.period_start", period: 2, t: 45 * 60 * 1000 + 100 }),
  },
  {
    atMs: 78 * 60 * 1000,
    make: (s) => {
      s.score.home = 2;
      return [
        { type: "event.shot", player: "HOM-10", target: { x: 52.5, y: 0.8, z: 0 }, on_target: true, t: 78 * 60 * 1000 },
        { type: "event.goal", player: "HOM-10", team: "HOM", assist: "HOM-7", t: 78 * 60 * 1000 },
        { type: "event.score_change", home: 2, away: 1, t: 78 * 60 * 1000 },
      ];
    },
  },
  {
    atMs: 90 * 60 * 1000,
    make: () => [
      { type: "event.period_end", period: 2, t: 90 * 60 * 1000 },
      { type: "event.match_end", t: 90 * 60 * 1000 },
    ],
  },
];

// ---------- match state ----------

function newMatchState() {
  return {
    startedAtMs: Date.now(),
    matchTimeMs: 0,
    players: initialPlayers(),
    ball: { pos: { x: 0, y: 0.11, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
    score: { home: 0, away: 0 },
    eventCursor: 0,
  };
}

function tick(state, dtMatchMs) {
  state.matchTimeMs += dtMatchMs;

  // Cheap idle motion so the renderer sees something change.
  // A real producer replaces this with their actual data source.
  const t = state.matchTimeMs / 1000;
  state.ball.pos.x = 5 * Math.sin(t * 0.4);
  state.ball.pos.z = 3 * Math.cos(t * 0.5);
  for (const p of state.players) {
    p.pos.x += (Math.random() - 0.5) * 0.04;
    p.pos.z += (Math.random() - 0.5) * 0.04;
  }

  const frame = {
    type: "state",
    t: state.matchTimeMs,
    ball: state.ball,
    players: state.players,
    period: state.matchTimeMs < 45 * 60 * 1000 ? 1 : state.matchTimeMs < 90 * 60 * 1000 ? 2 : 2,
    clock_display: formatClock(state.matchTimeMs),
  };

  const events = [];
  while (
    state.eventCursor < SCRIPTED_EVENTS.length &&
    SCRIPTED_EVENTS[state.eventCursor].atMs <= state.matchTimeMs
  ) {
    const made = SCRIPTED_EVENTS[state.eventCursor].make(state);
    if (Array.isArray(made)) events.push(...made);
    else events.push(made);
    state.eventCursor++;
  }
  return { frame, events };
}

function formatClock(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

// ---------- WebSocket server ----------

function startServer() {
  const wss = new WebSocketServer({ port: PORT, path: "/" });
  log(`listening on ws://localhost:${PORT}/`);
  log(`match_id=${MATCH_ID}, time_scale=${TIME_SCALE}x, tick=${TICK_HZ}Hz`);

  wss.on("connection", (ws) => {
    log("subscriber connected; emitting match.init + state stream");
    ws.send(JSON.stringify(MATCH_INIT));

    const state = newMatchState();
    const intervalMs = 1000 / TICK_HZ;
    const dtMatchMs = intervalMs * TIME_SCALE;

    const handle = setInterval(() => {
      if (ws.readyState !== ws.OPEN) {
        clearInterval(handle);
        return;
      }
      // Back-pressure: skip a tick if the socket's buffer is filling.
      if (ws.bufferedAmount > 256 * 1024) return;

      const { frame, events } = tick(state, dtMatchMs);
      ws.send(JSON.stringify(frame));
      for (const e of events) ws.send(JSON.stringify(e));

      if (state.matchTimeMs >= MATCH_DURATION_MS + 1000) {
        clearInterval(handle);
        log("match complete; closing");
        ws.close();
      }
    }, intervalMs);

    ws.on("close", () => {
      clearInterval(handle);
      log("subscriber disconnected");
    });
  });

  return wss;
}

// ---------- main ----------

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export { MATCH_INIT, newMatchState, tick, formatClock };
