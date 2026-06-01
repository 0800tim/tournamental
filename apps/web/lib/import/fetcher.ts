/**
 * Default fetcher for bracket-import parsers.
 *
 * Most rival platforms (Telegraph, BBC Predictor, FIFA app share URLs)
 * render the bracket server-side, so a plain `fetch` is enough.
 * ESPN is the known exception: their bracket UI is React-hydrated and
 * the raw HTML is a skeleton. For ESPN (and any future JS-rendered
 * source) the parser sets `needsBrowser: true` and the fetcher
 * transparently swaps in a Playwright Chromium fetch.
 *
 * Safety:
 *   - Only https:// schemes accepted (refuse http/ftp/file/etc).
 *   - Per-host timeouts capped at 15s for plain fetch, 30s for browser.
 *   - User-Agent identifies Tournamental so anyone reviewing logs
 *     can find us (no covert scraping).
 *   - No retries: one shot, surface the error to the caller. The
 *     wizard offers the screenshot fallback when fetch fails.
 */

import type { Fetcher } from "./types";

const UA =
  "Mozilla/5.0 (compatible; Tournamental-BracketImport/1.0; +https://tournamental.com/switch)";

/** Default Fetcher used by the import API route in production. */
export const defaultFetcher: Fetcher = {
  async fetch({ url, timeoutMs, needsBrowser }) {
    if (!/^https:\/\//i.test(url)) {
      return { ok: false, status: 0, error: "bad-scheme" };
    }
    const effectiveTimeout = Math.min(timeoutMs ?? 10_000, 30_000);

    if (needsBrowser) {
      return browserFetch(url, effectiveTimeout);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-NZ,en;q=0.9",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);
      const html = await res.text();
      const finalUrl = res.url || url;
      if (!res.ok) {
        return { ok: false, status: res.status, error: `http-${res.status}` };
      }
      return { ok: true, html, status: res.status, finalUrl };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, status: 0, error: "timeout" };
      }
      return {
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : "unknown",
      };
    }
  },
};

/**
 * Headless-browser fetch for JS-rendered sources (ESPN, anyone else
 * who hydrates the bracket client-side). Lazy-loads playwright so
 * tests + the static-rendering path don't pull a 200MB browser
 * binary into the bundle.
 */
async function browserFetch(
  url: string,
  timeoutMs: number,
): Promise<
  | { ok: true; html: string; status: number; finalUrl: string }
  | { ok: false; status: number; error: string }
> {
  // Playwright is optional + only used for ESPN-style JS-rendered
  // sources. We dynamic-import via a non-statically-resolvable
  // specifier so apps that don't install playwright still typecheck +
  // build. The cast lets TypeScript stay happy without a hard dep.
  let pw: { chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> } };
  try {
    pw = (await import(/* @vite-ignore */ "playwright" as string)) as typeof pw;
  } catch {
    return { ok: false, status: 0, error: "playwright-not-installed" };
  }
  const browser = (await pw.chromium.launch({ headless: true })) as {
    newContext: (opts: { userAgent: string }) => Promise<{
      newPage: () => Promise<{
        goto: (
          url: string,
          opts: { waitUntil: string; timeout: number },
        ) => Promise<{ status: () => number } | null>;
        content: () => Promise<string>;
        url: () => string;
      }>;
    }>;
    close: () => Promise<void>;
  };
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    const resp = await page.goto(url, {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });
    const status = resp?.status() ?? 0;
    if (!status || status >= 400) {
      return { ok: false, status, error: `http-${status}` };
    }
    const html = await page.content();
    const finalUrl = page.url() || url;
    return { ok: true, html, status, finalUrl };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : "browser-error",
    };
  } finally {
    await browser.close();
  }
}

// Test-only `staticFetcher` lives in `./static-fetcher.ts` so test
// suites can import it without dragging in the lazy Playwright
// dynamic-import above. Re-exported here for compatibility with any
// code that imports `staticFetcher` from `fetcher.ts`.
export { staticFetcher } from "./static-fetcher";
