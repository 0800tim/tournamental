/**
 * Wrapper around `fetch` for upstream service calls (CRM bridge, game-service,
 * affiliate-router audit, social-publisher etc.).
 *
 * The customer-360 page aggregates data from many independent services. Any
 * one of them may be offline or not yet shipped. This wrapper guarantees the
 * page never crashes from an upstream failure: every call returns either
 * the parsed JSON or `null`. The page then falls back to "no data yet"
 * placeholders.
 *
 * Errors are logged to stderr (never thrown) so the operator can see in the
 * server logs which upstream is down without the dashboard breaking.
 *
 * Tests mock `globalThis.fetch` directly — no extra plumbing required.
 */

const DEFAULT_TIMEOUT_MS = 4000;

export interface UpstreamGetOptions {
  /** Per-request timeout. Defaults to 4s — these are sidebar reads, not core. */
  timeoutMs?: number;
  /** Optional bearer token (e.g. for upstream services that gate by token). */
  token?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Tag for log lines. Defaults to URL host+path. */
  tag?: string;
}

export async function upstreamGet<T>(
  url: string,
  opts: UpstreamGetOptions = {},
): Promise<T | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, token, headers = {}, tag } = opts;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const finalHeaders: Record<string, string> = { Accept: "application/json", ...headers };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: finalHeaders,
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.error(`[upstream] ${tag ?? url} ${r.status}`);
      return null;
    }
    return (await r.json()) as T;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[upstream] ${tag ?? url} fetch failed:`, (err as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}
