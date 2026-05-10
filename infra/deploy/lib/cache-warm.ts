/**
 * cache-warm.ts — pre-warm caches after a swap.
 *
 * Hits a list of URLs with `Accept-Encoding: gzip, br` so:
 *   - Cloudflare edge re-fills its cache with the new asset hashes.
 *   - The Next.js / Astro server populates its in-process cache.
 *   - The Redis layer (if any) primes the hot rows.
 *
 * Reports the slow ones so we can investigate cache-miss regressions.
 */

export interface WarmTarget {
  url: string;
  /** Optional human label. */
  label?: string;
  /** Header overrides. */
  headers?: Record<string, string>;
  /** ms budget before the URL is reported as slow. Default 1500. */
  budgetMs?: number;
}

export interface WarmOptions {
  targets: WarmTarget[];
  /** Max concurrent requests. Default 4. */
  concurrency?: number;
  /** Logger. */
  log?: (line: string) => void;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

export interface WarmResult {
  url: string;
  label: string;
  status?: number;
  elapsedMs: number;
  ok: boolean;
  slow: boolean;
  error?: string;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'Accept-Encoding': 'gzip, br',
  'User-Agent': 'vtorn-deploy-cache-warmer/1.0',
};

/**
 * Hit each target once, with bounded concurrency. Returns one result
 * per target. Never throws — failed warms are non-fatal.
 */
export async function cacheWarm(opts: WarmOptions): Promise<WarmResult[]> {
  const log = opts.log ?? (() => undefined);
  const fetcher = opts.fetchImpl ?? fetch;
  const concurrency = opts.concurrency ?? 4;

  const queue = [...opts.targets];
  const results: WarmResult[] = [];

  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) return;
      const budget = t.budgetMs ?? 1500;
      const label = t.label ?? t.url;
      const t0 = Date.now();
      try {
        const res = await fetcher(t.url, {
          headers: { ...DEFAULT_HEADERS, ...(t.headers ?? {}) },
          signal: AbortSignal.timeout(15_000),
        });
        // drain body so the server actually generates the full response
        try {
          await res.arrayBuffer();
        } catch {
          // ignore
        }
        const elapsed = Date.now() - t0;
        const ok = res.status >= 200 && res.status < 400;
        const slow = elapsed > budget;
        results.push({
          url: t.url,
          label,
          status: res.status,
          elapsedMs: elapsed,
          ok,
          slow,
        });
        if (!ok) {
          log(`[warm] FAIL ${label}  HTTP ${res.status}  ${elapsed}ms`);
        } else if (slow) {
          log(`[warm] SLOW ${label}  ${elapsed}ms (budget ${budget}ms)`);
        } else {
          log(`[warm] OK   ${label}  ${elapsed}ms`);
        }
      } catch (err) {
        results.push({
          url: t.url,
          label,
          elapsedMs: Date.now() - t0,
          ok: false,
          slow: false,
          error: (err as Error).message,
        });
        log(`[warm] ERR  ${label}  ${(err as Error).message}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, opts.targets.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
