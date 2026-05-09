/**
 * Environment-driven configuration for the stream-server.
 *
 * Loaded once per process; the resulting object is passed explicitly to
 * the server builder so tests can override it without monkey-patching
 * `process.env`.
 */

export interface StreamConfig {
  port: number;
  bind: string;
  producerUrls: string[];
  ringSeconds: number;
  adminToken: string;
  maxConnsPerIp: number;
  maxConnsTotal: number;
  /** Per-subscriber outbound queue cap (messages, not bytes). */
  subscriberQueueMax: number;
  /** Close a subscriber whose queue stays full this long. */
  subscriberStallMs: number;
  /** Min/max reconnect backoff for upstream producer WS. */
  producerBackoffMinMs: number;
  producerBackoffMaxMs: number;
  /** Logging. */
  logLevel: string;
  logPretty: boolean;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StreamConfig {
  const producers = parseList(env.STREAM_PRODUCER_URLS);
  return {
    port: parsePositiveInt(env.STREAM_PORT, 4002),
    bind: env.STREAM_BIND ?? "0.0.0.0",
    producerUrls: producers.length > 0 ? producers : ["ws://localhost:4001"],
    ringSeconds: parsePositiveInt(env.STREAM_RING_SECONDS, 60),
    adminToken: env.STREAM_ADMIN_TOKEN ?? "",
    maxConnsPerIp: parsePositiveInt(env.STREAM_MAX_CONNS_PER_IP, 100),
    maxConnsTotal: parsePositiveInt(env.STREAM_MAX_CONNS_TOTAL, 5000),
    subscriberQueueMax: parsePositiveInt(env.STREAM_SUB_QUEUE_MAX, 120),
    subscriberStallMs: parsePositiveInt(env.STREAM_SUB_STALL_MS, 5000),
    producerBackoffMinMs: parsePositiveInt(env.STREAM_PRODUCER_BACKOFF_MIN_MS, 500),
    producerBackoffMaxMs: parsePositiveInt(env.STREAM_PRODUCER_BACKOFF_MAX_MS, 8000),
    logLevel: env.LOG_LEVEL ?? "info",
    logPretty: env.LOG_PRETTY === "1",
  };
}
