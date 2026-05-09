/**
 * Upstream WebSocket producer client.
 *
 * Subscribes to a single producer URL. On each incoming message:
 *   - parses NDJSON line(s) from the WS frame.
 *   - validates the message has a `type`.
 *   - routes the message to the appropriate match ring (init carries
 *     `match_id`; subsequent state/event frames are routed using the
 *     last-seen init from this producer).
 *   - calls the broadcaster so the hub fans out.
 *
 * Reconnect with exponential backoff + jitter. The pipeline owner sets
 * `start()` once; `stop()` cleans up and prevents further reconnects.
 */

import WebSocket, { type CloseEvent, type ErrorEvent, type MessageEvent } from "ws";
import type { Logger } from "pino";
import type { Message } from "@vtorn/spec";

export interface ProducerOptions {
  url: string;
  logger: Logger;
  /** Called for each parsed message. Must not throw. */
  onMessage: (msg: Message) => void;
  /** Called when the connection state changes. */
  onState?: (state: ProducerState) => void;
  backoffMinMs: number;
  backoffMaxMs: number;
  /** Override the WS factory; tests can inject a fake. */
  wsFactory?: (url: string) => WebSocket;
}

export type ProducerState = "connecting" | "open" | "closed" | "stopped";

export interface ProducerStatus {
  url: string;
  state: ProducerState;
  frames_in: number;
  parse_errors: number;
  reconnects: number;
  last_frame_at: number; // wall ms; 0 if never
  current_match_id: string | null;
  connected_at: number; // wall ms; 0 when not open
}

export class ProducerClient {
  private url: string;
  private logger: Logger;
  private onMessage: (msg: Message) => void;
  private onState?: (state: ProducerState) => void;
  private backoffMinMs: number;
  private backoffMaxMs: number;
  private wsFactory: (url: string) => WebSocket;

  private ws: WebSocket | null = null;
  private state: ProducerState = "closed";
  private currentMatchId: string | null = null;
  private framesIn = 0;
  private parseErrors = 0;
  private reconnects = 0;
  private lastFrameAt = 0;
  private connectedAt = 0;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private currentBackoff: number;

  constructor(opts: ProducerOptions) {
    this.url = opts.url;
    this.logger = opts.logger.child({ producer: opts.url });
    this.onMessage = opts.onMessage;
    this.onState = opts.onState;
    this.backoffMinMs = opts.backoffMinMs;
    this.backoffMaxMs = opts.backoffMaxMs;
    this.wsFactory =
      opts.wsFactory ??
      ((u: string) => new WebSocket(u, { handshakeTimeout: 5_000 }));
    this.currentBackoff = this.backoffMinMs;
  }

  start(): void {
    if (this.stopped) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.transition("stopped");
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  status(): ProducerStatus {
    return {
      url: this.url,
      state: this.state,
      frames_in: this.framesIn,
      parse_errors: this.parseErrors,
      reconnects: this.reconnects,
      last_frame_at: this.lastFrameAt,
      current_match_id: this.currentMatchId,
      connected_at: this.connectedAt,
    };
  }

  private transition(next: ProducerState): void {
    if (this.state === next) return;
    this.state = next;
    this.onState?.(next);
  }

  private connect(): void {
    if (this.stopped) return;
    this.transition("connecting");
    let ws: WebSocket;
    try {
      ws = this.wsFactory(this.url);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, "ws factory threw");
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connectedAt = Date.now();
      this.currentBackoff = this.backoffMinMs;
      this.transition("open");
      this.logger.info({ url: this.url }, "producer connected");
    };

    ws.onmessage = (ev: MessageEvent) => {
      this.handleData(ev.data);
    };

    ws.onerror = (ev: ErrorEvent) => {
      this.logger.debug({ err: ev.message }, "producer ws error");
    };

    ws.onclose = (ev: CloseEvent) => {
      this.connectedAt = 0;
      this.ws = null;
      if (this.stopped) {
        this.transition("stopped");
        return;
      }
      this.transition("closed");
      this.logger.info({ code: ev.code, reason: ev.reason }, "producer closed; will reconnect");
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnects += 1;
    const jitter = Math.random() * this.currentBackoff * 0.25;
    const wait = Math.min(this.currentBackoff + jitter, this.backoffMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
    this.currentBackoff = Math.min(this.currentBackoff * 2, this.backoffMaxMs);
  }

  private handleData(data: WebSocket.Data): void {
    let str: string;
    if (typeof data === "string") str = data;
    else if (Buffer.isBuffer(data)) str = data.toString("utf8");
    else if (Array.isArray(data)) str = Buffer.concat(data as Buffer[]).toString("utf8");
    else if (data instanceof ArrayBuffer) str = Buffer.from(data).toString("utf8");
    else {
      this.parseErrors += 1;
      return;
    }
    // Some emitters batch multiple lines per WS frame. Tolerate that.
    const lines = str.split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.parseErrors += 1;
        continue;
      }
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as { type?: unknown }).type !== "string"
      ) {
        this.parseErrors += 1;
        continue;
      }
      const msg = parsed as Message;
      if (msg.type === "match.init") {
        this.currentMatchId = (msg as { match_id?: string }).match_id ?? null;
      }
      this.framesIn += 1;
      this.lastFrameAt = Date.now();
      try {
        this.onMessage(msg);
      } catch (err) {
        this.logger.error({ err: (err as Error).message }, "onMessage threw");
      }
    }
  }
}
