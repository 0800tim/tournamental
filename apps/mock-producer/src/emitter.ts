/**
 * Output emitters for the mock producer.
 *
 * All emitters consume `Message[]` produced by the simulation core and
 * deliver them as a paced stream. Pacing is determined by the message's
 * own `t` value (ms since match.init), divided by `--time-scale` to give
 * wall-clock delay.
 *
 * Emitters:
 *   - StdoutEmitter   — NDJSON to stdout, paced.
 *   - FileEmitter     — `init.json` + `chunk-NNNNNN.ndjson.gz` + `live.m3u8`.
 *                       Writes the full stream non-paced (all at once);
 *                       this matches what a renderer would download.
 *   - WebSocketEmitter — broadcast to all WS clients on `--port`. New
 *                        clients receive the cached `init` on connect plus
 *                        a backlog catch-up of recent messages.
 *   - SseEmitter      — HTTP SSE on `/stream`, similar semantics.
 *
 * All paced emitters use a shared `pacedDispatch` helper so timing
 * behaviour is identical.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { MatchInit, Message } from "@vtorn/spec";

export interface EmitterContext {
  init: MatchInit;
  messages: Message[]; // includes init at index 0
  timeScale: number;   // 1 = real time; 10 = 10x faster.
  signal?: AbortSignal;
}

export interface Emitter {
  run(): Promise<void>;
}

// ---------- helpers ----------

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(new Error("aborted"));
    const timer = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      rej(new Error("aborted"));
    }, { once: true });
  });
}

/**
 * Dispatch messages in `t` order, sleeping between consecutive `t`s by
 * (deltaT / timeScale) ms.
 *
 * The init message is at index 0 and is always sent first with no delay.
 * Push-mode emitters (ws, sse) MAY suppress this init via
 * `opts.skipInit = true` when they already serve init synchronously on
 * connection — that avoids racing the connection handler against the
 * paced loop, which otherwise lets state frames overtake init.
 */
interface PacedDispatchOpts {
  skipInit?: boolean;
}

async function pacedDispatch(
  ctx: EmitterContext,
  send: (msg: Message) => void,
  opts: PacedDispatchOpts = {},
): Promise<void> {
  const { messages, timeScale, signal } = ctx;
  if (messages.length === 0) return;
  if (!opts.skipInit) {
    send(messages[0] as Message); // match.init
  }
  let lastT = 0;
  const startedAt = Date.now();
  for (let i = 1; i < messages.length; i++) {
    if (signal?.aborted) return;
    const m = messages[i] as Message;
    const t = "t" in m ? (m.t as number) : lastT;
    const elapsedTarget = t / timeScale;
    const elapsedActual = Date.now() - startedAt;
    const wait = elapsedTarget - elapsedActual;
    if (wait > 0) {
      await delay(wait, signal);
    }
    send(m);
    lastT = t;
  }
}

// ---------- stdout ----------

export class StdoutEmitter implements Emitter {
  constructor(private readonly ctx: EmitterContext) {}
  async run(): Promise<void> {
    await pacedDispatch(this.ctx, (m) => {
      process.stdout.write(JSON.stringify(m) + "\n");
    });
  }
}

// ---------- file ----------

export interface FileEmitterOptions {
  outDir: string;
  chunkDurationMs?: number; // default 30s
}

/**
 * Writes a CDN-style snapshot: init.json + chunk-NNNNNN.ndjson.gz + live.m3u8.
 *
 * Chunks are bucketed by message `t` into `chunkDurationMs`-wide windows.
 * The manifest is HLS-style (#EXTM3U with #EXTINF tags) so a renderer's
 * stream client can iterate.
 */
export class FileEmitter implements Emitter {
  constructor(
    private readonly ctx: EmitterContext,
    private readonly opts: FileEmitterOptions,
  ) {}
  async run(): Promise<void> {
    const chunkDurationMs = this.opts.chunkDurationMs ?? 30_000;
    const outDir = resolve(this.opts.outDir);
    await mkdir(outDir, { recursive: true });

    // init.json
    await writeFile(
      resolve(outDir, "init.json"),
      JSON.stringify(this.ctx.init, null, 2),
      "utf8",
    );

    // Bucket non-init messages by chunk.
    const chunks: Map<number, string[]> = new Map();
    let maxT = 0;
    for (let i = 1; i < this.ctx.messages.length; i++) {
      const m = this.ctx.messages[i] as Message;
      const t = "t" in m ? (m.t as number) : 0;
      maxT = Math.max(maxT, t);
      const idx = Math.floor(t / chunkDurationMs);
      const arr = chunks.get(idx) ?? [];
      arr.push(JSON.stringify(m));
      chunks.set(idx, arr);
    }

    // Write chunks gzipped.
    const indices = Array.from(chunks.keys()).sort((a, b) => a - b);
    const manifestLines: string[] = [
      "#EXTM3U",
      "#EXT-X-VERSION:6",
      `#EXT-X-TARGETDURATION:${Math.ceil(chunkDurationMs / 1000)}`,
      "#EXT-X-MEDIA-SEQUENCE:0",
    ];
    for (const idx of indices) {
      const lines = chunks.get(idx) ?? [];
      const ndjson = lines.join("\n") + "\n";
      const gz = gzipSync(ndjson);
      const filename = `chunk-${String(idx).padStart(6, "0")}.ndjson.gz`;
      await writeFile(resolve(outDir, filename), gz);
      manifestLines.push(`#EXTINF:${(chunkDurationMs / 1000).toFixed(3)},`);
      manifestLines.push(filename);
    }
    manifestLines.push("#EXT-X-ENDLIST", "");
    await writeFile(resolve(outDir, "live.m3u8"), manifestLines.join("\n"), "utf8");
  }
}

// ---------- websocket ----------

export interface WebSocketEmitterOptions {
  port: number;
  path?: string; // optional URL path constraint, e.g. "/stream"
}

export class WebSocketEmitter implements Emitter {
  constructor(
    private readonly ctx: EmitterContext,
    private readonly opts: WebSocketEmitterOptions,
  ) {}
  async run(): Promise<void> {
    const wss = new WebSocketServer({ port: this.opts.port, path: this.opts.path });
    const recentBacklog: string[] = [];
    const initLine = JSON.stringify(this.ctx.init);

    wss.on("connection", (ws: WebSocket) => {
      ws.send(initLine);
      // Send a small backlog so a late connector immediately sees recent state.
      for (const line of recentBacklog) {
        ws.send(line);
      }
    });

    const send = (m: Message): void => {
      const line = JSON.stringify(m);
      if (m.type !== "match.init") {
        recentBacklog.push(line);
        if (recentBacklog.length > 40) recentBacklog.shift();
      }
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
          client.send(line);
        }
      }
    };

    process.stderr.write(`[mock-producer] WebSocket listening on ws://0.0.0.0:${this.opts.port}${this.opts.path ?? ""}\n`);
    try {
      await pacedDispatch(this.ctx, send, { skipInit: true });
    } finally {
      // Hold the server open briefly so the last message reaches connected
      // clients. In typical dev use the operator Ctrl-Cs anyway.
      await delay(200);
      wss.close();
    }
  }
}

// ---------- sse ----------

export interface SseEmitterOptions {
  port: number;
  path?: string; // default "/stream"
}

export class SseEmitter implements Emitter {
  constructor(
    private readonly ctx: EmitterContext,
    private readonly opts: SseEmitterOptions,
  ) {}
  async run(): Promise<void> {
    const path = this.opts.path ?? "/stream";
    const clients = new Set<ServerResponse>();
    const recentBacklog: string[] = [];
    const initLine = JSON.stringify(this.ctx.init);

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== path) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(`data: ${initLine}\n\n`);
      for (const line of recentBacklog) {
        res.write(`data: ${line}\n\n`);
      }
      clients.add(res);
      req.on("close", () => clients.delete(res));
    });
    server.listen(this.opts.port);

    process.stderr.write(`[mock-producer] SSE listening on http://0.0.0.0:${this.opts.port}${path}\n`);

    const send = (m: Message): void => {
      const line = JSON.stringify(m);
      if (m.type !== "match.init") {
        recentBacklog.push(line);
        if (recentBacklog.length > 40) recentBacklog.shift();
      }
      for (const c of clients) {
        c.write(`data: ${line}\n\n`);
      }
    };

    try {
      await pacedDispatch(this.ctx, send, { skipInit: true });
    } finally {
      await delay(200);
      for (const c of clients) c.end();
      server.close();
    }
  }
}
