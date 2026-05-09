/**
 * Shared test helpers — in-memory fake producer + small message factories.
 */

import { WebSocket } from "ws";
import { EventEmitter } from "node:events";
import type {
  MatchInit,
  StateFrame,
  EventMessage,
} from "@vtorn/spec";
import { SPEC_VERSION } from "@vtorn/spec";

export function makeInit(matchId = "m-test"): MatchInit {
  return {
    type: "match.init",
    spec_version: SPEC_VERSION,
    match_id: matchId,
    sport: "soccer",
    field: { length: 105, width: 68, units: "m" },
    teams: [
      {
        id: "T_HOME",
        name: "Home",
        kit: { primary: "#0044FF", secondary: "#FFFFFF" },
        players: [
          { id: "P_H1", name: "Home One", number: 1, position: "GK" },
        ],
      },
      {
        id: "T_AWAY",
        name: "Away",
        kit: { primary: "#FF0000", secondary: "#FFFFFF" },
        players: [
          { id: "P_A1", name: "Away One", number: 1, position: "GK" },
        ],
      },
    ],
    start_time: new Date(0).toISOString(),
    producer: "test-helpers",
  };
}

export function makeStateFrame(t: number): StateFrame {
  return {
    type: "state",
    t,
    ball: { pos: [0, 0, 0.11] },
    players: [
      {
        id: "P_H1",
        pos: [-50, 0],
        facing: 0,
        anim: "idle",
      },
      {
        id: "P_A1",
        pos: [50, 0],
        facing: Math.PI,
        anim: "idle",
      },
    ],
  };
}

export function makeGoalEvent(t: number): EventMessage {
  return { type: "event.goal", t, player: "P_H1", team: "T_HOME" };
}

/**
 * A minimal in-process fake WS that satisfies the surface our
 * ProducerClient calls on it (`onopen`, `onmessage`, `onclose`,
 * `onerror`, `close`, `readyState`).
 *
 * Used to test producer reconnect deterministically.
 */
export class FakeWS extends EventEmitter {
  public readyState = WebSocket.CONNECTING;
  public CONNECTING = WebSocket.CONNECTING;
  public OPEN = WebSocket.OPEN;
  public CLOSING = WebSocket.CLOSING;
  public CLOSED = WebSocket.CLOSED;

  public onopen: (() => void) | null = null;
  public onmessage: ((ev: { data: unknown }) => void) | null = null;
  public onerror: ((ev: { message: string }) => void) | null = null;
  public onclose: ((ev: { code: number; reason: string }) => void) | null = null;

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }
  push(line: string): void {
    this.onmessage?.({ data: line });
  }
  fail(message: string): void {
    this.onerror?.({ message });
  }
  drop(code = 1006, reason = "abnormal"): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
  close(): void {
    this.drop(1000, "client close");
  }
}

export async function nextTick(): Promise<void> {
  await new Promise((res) => setImmediate(res));
}

export async function waitFor(
  fn: () => boolean,
  timeoutMs = 2000,
  pollMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((res) => setTimeout(res, pollMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
