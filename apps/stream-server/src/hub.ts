/**
 * Subscriber hub: per-match fan-out with bounded per-subscriber queues.
 *
 * Design:
 *   - Each Subscriber wraps a `ws.WebSocket` plus a small outbound queue.
 *   - The hub's `broadcast()` is called by the producer pipeline on each
 *     incoming message. It enqueues a copy onto every subscriber's
 *     queue. Slow subscribers' queues fill; we drop oldest frames and
 *     increment a counter rather than blocking the producer.
 *   - A subscriber whose queue stays full for `stallMs` is closed.
 *
 * Why drop-from-front rather than drop-on-write: a subscriber catching
 * up needs the *latest* state, not the staleness from N seconds ago.
 * Drop-from-front lets the subscriber jump to head once it drains.
 *
 * The hub never blocks. Producer ingress never `await`s a subscriber
 * send. This is the back-pressure firewall.
 */

import type { WebSocket } from "ws";
import type { Logger } from "pino";
import type { Message } from "@vtorn/spec";
import type { MatchRing } from "./ring.js";

export interface SubscriberOptions {
  ws: WebSocket;
  matchId: string;
  ip: string;
  queueMax: number;
  stallMs: number;
  logger: Logger;
}

interface SubscriberStats {
  messages_sent: number;
  frames_dropped: number;
}

class Subscriber {
  readonly ws: WebSocket;
  readonly matchId: string;
  readonly ip: string;
  readonly id: string;
  private queue: string[] = [];
  private queueMax: number;
  private stallMs: number;
  private fullSince: number | null = null;
  private writing = false;
  private closed = false;
  private logger: Logger;
  readonly stats: SubscriberStats = { messages_sent: 0, frames_dropped: 0 };
  readonly connectedAt = Date.now();

  constructor(opts: SubscriberOptions) {
    this.ws = opts.ws;
    this.matchId = opts.matchId;
    this.ip = opts.ip;
    this.queueMax = opts.queueMax;
    this.stallMs = opts.stallMs;
    this.logger = opts.logger;
    this.id = `${opts.ip}:${Math.random().toString(36).slice(2, 10)}`;

    this.ws.on("close", () => {
      this.closed = true;
    });
    this.ws.on("error", () => {
      // best-effort; .close handler will fire too
      this.closed = true;
    });
  }

  /** Queue a serialised message line. Drops if subscriber is over-full. */
  enqueue(line: string): void {
    if (this.closed) return;
    if (this.queue.length >= this.queueMax) {
      // Drop from the front so the next pump gets fresh state.
      this.queue.shift();
      this.stats.frames_dropped += 1;
      if (this.fullSince === null) {
        this.fullSince = Date.now();
      } else if (Date.now() - this.fullSince > this.stallMs) {
        this.logger.warn(
          { sub: this.id, ip: this.ip, dropped: this.stats.frames_dropped },
          "subscriber stalled, closing",
        );
        this.terminate();
        return;
      }
    } else {
      this.fullSince = null;
    }
    this.queue.push(line);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.writing || this.closed) return;
    this.writing = true;
    try {
      while (this.queue.length > 0 && !this.closed && this.ws.readyState === this.ws.OPEN) {
        const line = this.queue.shift()!;
        await new Promise<void>((res) => {
          this.ws.send(line, (err) => {
            if (err) {
              this.logger.debug({ sub: this.id, err: err.message }, "send err");
              this.closed = true;
            }
            this.stats.messages_sent += 1;
            res();
          });
        });
      }
    } finally {
      this.writing = false;
    }
  }

  /** Send the cached init + buffered ring frames as a synchronous burst. */
  primeFromRing(ring: MatchRing): void {
    const init = ring.getInit();
    if (init !== undefined) {
      this.enqueue(JSON.stringify(init));
    }
    const frames = ring.snapshotFrames();
    for (const f of frames) {
      this.enqueue(JSON.stringify(f));
    }
  }

  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(1011, "subscriber overrun");
    } catch {
      /* ignore */
    }
  }

  isClosed(): boolean {
    return this.closed || this.ws.readyState === this.ws.CLOSING || this.ws.readyState === this.ws.CLOSED;
  }
}

export class SubscriberHub {
  private byMatch: Map<string, Set<Subscriber>> = new Map();
  private byIp: Map<string, number> = new Map();
  private total = 0;

  constructor(private readonly logger: Logger) {}

  /** Register a new subscriber. Returns the registered Subscriber, or null if rate-limited. */
  add(opts: SubscriberOptions, limits: { perIp: number; total: number }): Subscriber | { rejected: "per_ip" | "total" } {
    if (this.total >= limits.total) {
      return { rejected: "total" };
    }
    const ipCount = this.byIp.get(opts.ip) ?? 0;
    if (ipCount >= limits.perIp) {
      return { rejected: "per_ip" };
    }
    const sub = new Subscriber(opts);
    let set = this.byMatch.get(opts.matchId);
    if (!set) {
      set = new Set();
      this.byMatch.set(opts.matchId, set);
    }
    set.add(sub);
    this.byIp.set(opts.ip, ipCount + 1);
    this.total += 1;
    sub.ws.on("close", () => this.remove(sub));
    return sub;
  }

  private remove(sub: Subscriber): void {
    const set = this.byMatch.get(sub.matchId);
    if (set?.has(sub)) {
      set.delete(sub);
      if (set.size === 0) this.byMatch.delete(sub.matchId);
      this.total -= 1;
      const ipCount = (this.byIp.get(sub.ip) ?? 1) - 1;
      if (ipCount <= 0) this.byIp.delete(sub.ip);
      else this.byIp.set(sub.ip, ipCount);
    }
  }

  /** Broadcast one message to all subscribers of `matchId`. */
  broadcast(matchId: string, msg: Message): void {
    const set = this.byMatch.get(matchId);
    if (!set || set.size === 0) return;
    const line = JSON.stringify(msg);
    for (const sub of set) {
      sub.enqueue(line);
    }
  }

  countByMatch(matchId: string): number {
    return this.byMatch.get(matchId)?.size ?? 0;
  }

  totalCount(): number {
    return this.total;
  }

  /** Sum of per-subscriber drop counters across all subs. */
  totalDropped(): number {
    let n = 0;
    for (const set of this.byMatch.values()) {
      for (const s of set) n += s.stats.frames_dropped;
    }
    return n;
  }

  /** Disconnect everyone and clear state — used on shutdown. */
  closeAll(): void {
    for (const set of this.byMatch.values()) {
      for (const sub of set) sub.terminate();
    }
    this.byMatch.clear();
    this.byIp.clear();
    this.total = 0;
  }

  /** For tests/admin: list all current subscriber stats. */
  describe(): Array<{ match_id: string; ip: string; sent: number; dropped: number; age_ms: number }> {
    const out: Array<{ match_id: string; ip: string; sent: number; dropped: number; age_ms: number }> = [];
    const now = Date.now();
    for (const [matchId, set] of this.byMatch) {
      for (const s of set) {
        out.push({
          match_id: matchId,
          ip: s.ip,
          sent: s.stats.messages_sent,
          dropped: s.stats.frames_dropped,
          age_ms: now - s.connectedAt,
        });
      }
    }
    return out;
  }
}

export type { Subscriber };
