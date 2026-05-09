/**
 * WebSocketEmitter smoke test: a client connects, receives match.init
 * and at least one state frame, and the messages it sees parse cleanly.
 *
 * This guards the WS path even before the renderer (`apps/web`) ships.
 */
import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { runSimulation, defaultTeams, WebSocketEmitter, validateMessage } from "../src/index.js";

function pickPort(): number {
  return 4_500 + Math.floor(Math.random() * 200);
}

describe("WebSocketEmitter", () => {
  it("broadcasts match.init plus state frames at high time-scale", async () => {
    // 60s match at time-scale 1000 → finishes in ~60ms, easy to test.
    const r = runSimulation({
      seed: 42,
      matchDurationMs: 60_000,
      teams: defaultTeams(),
    });
    const port = pickPort();
    const emitter = new WebSocketEmitter(
      { init: r.init, messages: r.messages, timeScale: 1000 },
      { port },
    );
    const runPromise = emitter.run();
    // Tiny pause for server to listen.
    await new Promise((res) => setTimeout(res, 50));

    const received: unknown[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    // Attach message handler BEFORE waiting for open so we don't drop the
    // init message that the server sends on connection.
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as unknown;
        received.push(msg);
      } catch (err) {
        received.push({ parseError: (err as Error).message });
      }
    });
    await new Promise<void>((res, rej) => {
      ws.on("open", () => res());
      ws.on("error", rej);
    });

    await runPromise;
    ws.close();

    expect(received.length).toBeGreaterThan(10);
    const init = received[0] as { type: string };
    expect(init.type).toBe("match.init");
    // Every received message validates.
    for (const m of received) {
      validateMessage(m);
    }
    // At least one state frame.
    expect(received.some((m) => (m as { type: string }).type === "state")).toBe(true);
  }, 15_000);
});
