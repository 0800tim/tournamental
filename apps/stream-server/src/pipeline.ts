/**
 * Pipeline: glue between ProducerClient(s), MatchRing(s), and SubscriberHub.
 *
 * One pipeline owns all upstream producers and all per-match rings for
 * a server instance. The HTTP/WS server holds a reference to the
 * pipeline and queries it for ring snapshots when subscribing a new
 * client.
 *
 * Routing rule: incoming messages from a producer are tagged with the
 * `match_id` of the most recent `MatchInit` seen from that producer. If
 * a producer has not yet emitted an init, frames are buffered into a
 * "pending" ring keyed by the producer URL — they get re-keyed once an
 * init arrives. (In practice the AR-FR producer emits init first, so
 * the pending ring is rarely used; it's a robustness measure.)
 */

import type { Logger } from "pino";
import type { Message } from "@tournamental/spec";
import { MatchRing } from "./ring.js";
import { SubscriberHub } from "./hub.js";
import { ProducerClient, type ProducerStatus } from "./producer.js";
import type { StreamConfig } from "./config.js";

export interface PipelineOptions {
  config: StreamConfig;
  logger: Logger;
  /** Inject a producer factory for tests. */
  producerFactory?: (
    url: string,
    onMessage: (msg: Message) => void,
  ) => ProducerClient;
}

export class Pipeline {
  readonly hub: SubscriberHub;
  private rings: Map<string, MatchRing> = new Map();
  private producers: ProducerClient[] = [];
  private producerCurrentMatch: Map<string, string> = new Map(); // url -> current match_id
  private logger: Logger;
  private config: StreamConfig;
  private startedAt = 0;

  constructor(opts: PipelineOptions) {
    this.config = opts.config;
    this.logger = opts.logger;
    this.hub = new SubscriberHub(this.logger.child({ scope: "hub" }));

    const factory =
      opts.producerFactory ??
      ((url, onMessage) =>
        new ProducerClient({
          url,
          logger: this.logger,
          onMessage,
          backoffMinMs: this.config.producerBackoffMinMs,
          backoffMaxMs: this.config.producerBackoffMaxMs,
        }));

    for (const url of this.config.producerUrls) {
      const producer = factory(url, (msg) => this.handleProducerMessage(url, msg));
      this.producers.push(producer);
    }
  }

  start(): void {
    this.startedAt = Date.now();
    for (const p of this.producers) p.start();
  }

  stop(): void {
    for (const p of this.producers) p.stop();
    this.hub.closeAll();
  }

  private handleProducerMessage(producerUrl: string, msg: Message): void {
    let matchId: string;
    if (msg.type === "match.init") {
      matchId = msg.match_id;
      this.producerCurrentMatch.set(producerUrl, matchId);
    } else {
      const known = this.producerCurrentMatch.get(producerUrl);
      if (!known) {
        // No init yet — drop the frame on the floor. This is rare; a
        // well-behaved producer always emits init first.
        return;
      }
      matchId = known;
    }
    const ring = this.getOrCreateRing(matchId);
    ring.push(msg);
    this.hub.broadcast(matchId, msg);
  }

  private getOrCreateRing(matchId: string): MatchRing {
    let r = this.rings.get(matchId);
    if (!r) {
      r = new MatchRing(this.config.ringSeconds * 1000);
      this.rings.set(matchId, r);
    }
    return r;
  }

  getRing(matchId: string): MatchRing | undefined {
    return this.rings.get(matchId);
  }

  /** All match_ids known to the pipeline (i.e. any producer has emitted init). */
  matchIds(): string[] {
    return Array.from(this.rings.keys());
  }

  producerStatuses(): ProducerStatus[] {
    return this.producers.map((p) => p.status());
  }

  /**
   * Aggregate frame rate (frames/sec) since pipeline start, summed
   * across all producers.
   */
  frameRateHz(): number {
    if (this.startedAt === 0) return 0;
    const seconds = (Date.now() - this.startedAt) / 1000;
    if (seconds <= 0) return 0;
    let total = 0;
    for (const p of this.producers) total += p.status().frames_in;
    return total / seconds;
  }

  /**
   * The "freshest" ring's age in ms — useful for healthz. Returns
   * `Infinity` if no ring has been touched yet.
   */
  freshestRingAgeMs(): number {
    let best = Number.POSITIVE_INFINITY;
    for (const r of this.rings.values()) {
      const age = r.ageMs();
      if (age < best) best = age;
    }
    return best;
  }

  /** Inject a message directly — used by tests to bypass real producers. */
  injectForTest(producerUrl: string, msg: Message): void {
    this.handleProducerMessage(producerUrl, msg);
  }
}
