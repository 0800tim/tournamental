/**
 * Tiny HTTP client with exponential-backoff retries.
 *
 * Retries on 429 + 5xx (transient classes). 4xx errors bail immediately so
 * callers don't burn quota on a permanently-broken request.
 */

import { authHeaders } from "./auth.js";

export const DEFAULT_BASE_URL = "https://api.tournamental.com";

export interface ClientOpts {
  baseUrl?: string;
  apiKey: string;
  /** Pluggable fetch for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Base delay between retries, ms. Default 200. */
  retryBaseMs?: number;
  /** Maximum number of attempts (including the first try). Default 3. */
  maxRetries?: number;
  /** Optional extra request headers (e.g. user-agent). */
  extraHeaders?: Record<string, string>;
}

export interface PostResult<T> {
  data: T;
  status: number;
  attempts: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST a JSON body to {baseUrl}{path}. Returns the parsed JSON body.
 *
 * Retries on 429 + 5xx with exponential backoff: delays follow
 *   base * 2^attempt  (e.g. 200, 400, 800 ms for default base 200).
 *
 * Throws on 4xx (other than 429) and after `maxRetries` attempts of 5xx/429.
 */
export async function postWithRetry<T>(
  opts: ClientOpts,
  path: string,
  body: unknown,
): Promise<T> {
  const result = await postWithRetryResult<T>(opts, path, body);
  return result.data;
}

/**
 * Same as postWithRetry but exposes the final status code and attempt count.
 * Useful for instrumentation in the Swarm.
 */
export async function postWithRetryResult<T>(
  opts: ClientOpts,
  path: string,
  body: unknown,
): Promise<PostResult<T>> {
  const fetcher = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  if (!fetcher) {
    throw new Error(
      "bot-sdk: no fetch implementation available. Pass `fetchImpl` or run on Node >= 20.",
    );
  }
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const retryBaseMs = opts.retryBaseMs ?? 200;
  const maxRetries = opts.maxRetries ?? 3;
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(opts.apiKey),
    ...(opts.extraHeaders ?? {}),
  };

  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt < maxRetries) {
    attempt += 1;
    let res: Response;
    try {
      res = await fetcher(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      lastErr = networkErr;
      if (attempt < maxRetries) {
        await sleep(retryBaseMs * 2 ** (attempt - 1));
        continue;
      }
      throw networkErr;
    }

    if (res.ok) {
      const data = (await res.json()) as T;
      return { data, status: res.status, attempts: attempt };
    }

    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < maxRetries) {
      lastErr = new Error(`HTTP ${res.status}`);
      await sleep(retryBaseMs * 2 ** (attempt - 1));
      continue;
    }

    const errBody = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(errBody)}`);
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("bot-sdk: max_retries_exceeded");
}
