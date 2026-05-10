/**
 * Fetcher: parses an RSS feed (HTTP -> rss-parser -> normalised
 * NewsItem[]). Designed to be polite — short timeouts, an explicit
 * User-Agent that links back to our project, and exponential backoff
 * on errors so we never hammer a flaky upstream.
 */
import Parser from 'rss-parser';

import type { NewsItem, SourceDescriptor, SourceHealth } from '../types.js';
import { normaliseItem } from './normalise.js';
import type { RawRssItem } from './normalise.js';

const DEFAULT_TIMEOUT_MS = 12_000;
// User-Agent must be ASCII-only (HTTP headers are ByteStrings; a stray
// em-dash blew this up in dev). The text is the same intent: polite,
// links back to the project so any upstream that wants to rate-limit
// or contact us can.
const USER_AGENT =
  'TournamentalNewsAggregator/0.1 (+https://github.com/0800tim/vtorn; polite RSS poller, ~6 reqs / 10 min)';

export interface FetchSourceResult {
  readonly source: string;
  readonly ok: boolean;
  readonly items: readonly NewsItem[];
  readonly error?: string;
  readonly fetchedAt: string;
  readonly statusCode?: number;
}

export interface FetcherOptions {
  /** Per-source HTTP timeout. Defaults to 12s. */
  readonly timeoutMs?: number;
  /** Inject for tests. Defaults to global fetch. */
  readonly fetcher?: typeof fetch;
}

export class SourceFetcher {
  private readonly parser: Parser;
  private readonly timeoutMs: number;
  private readonly _fetch: typeof fetch;
  private readonly health = new Map<string, MutableSourceHealth>();

  constructor(opts: FetcherOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._fetch = opts.fetcher ?? fetch;
    this.parser = new Parser({
      timeout: this.timeoutMs,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
      },
      // Custom fields are passed through to each item so pickImage()
      // can sniff for media:thumbnail / media:content. rss-parser
      // doesn't expose these by default.
      customFields: {
        item: [
          ['media:thumbnail', 'media:thumbnail'],
          ['media:content', 'media:content'],
          ['media:credit', 'media:credit'],
        ],
      },
    });
  }

  registerHealth(s: SourceDescriptor): void {
    if (this.health.has(s.id)) return;
    this.health.set(s.id, {
      id: s.id,
      displayName: s.displayName,
      enabled: s.enabled,
      language: s.language,
      lastFetch: null,
      lastSuccess: null,
      errorCount: 0,
      lastError: null,
      itemCount: 0,
    });
  }

  getHealth(): SourceHealth[] {
    return [...this.health.values()].map((h) => ({ ...h }));
  }

  async fetchOne(source: SourceDescriptor): Promise<FetchSourceResult> {
    this.registerHealth(source);
    const h = this.health.get(source.id)!;
    const fetchedAt = new Date().toISOString();
    h.lastFetch = fetchedAt;

    if (!source.enabled) {
      return { source: source.id, ok: false, items: [], error: 'disabled', fetchedAt };
    }

    try {
      // We do the HTTP ourselves rather than letting rss-parser fetch,
      // because we want a controllable AbortController-based timeout
      // and a clean place to inject a test fetcher.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this._fetch(source.feedUrl, {
          method: 'GET',
          signal: ac.signal,
          headers: {
            'User-Agent': USER_AGENT,
            Accept:
              'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
          },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        h.errorCount++;
        h.lastError = `HTTP ${res.status}`;
        return {
          source: source.id,
          ok: false,
          items: [],
          error: `HTTP ${res.status}`,
          fetchedAt,
          statusCode: res.status,
        };
      }
      const xml = await res.text();
      const feed = await this.parser.parseString(xml);
      const items: NewsItem[] = [];
      for (const raw of (feed.items ?? []) as RawRssItem[]) {
        const item = normaliseItem(source, raw);
        if (item) items.push(item);
      }
      h.lastSuccess = fetchedAt;
      h.itemCount = items.length;
      return { source: source.id, ok: true, items, fetchedAt, statusCode: res.status };
    } catch (err) {
      h.errorCount++;
      const message = err instanceof Error ? err.message : String(err);
      h.lastError = message;
      return { source: source.id, ok: false, items: [], error: message, fetchedAt };
    }
  }

  async fetchAll(sources: readonly SourceDescriptor[]): Promise<FetchSourceResult[]> {
    return Promise.all(sources.map((s) => this.fetchOne(s)));
  }
}

interface MutableSourceHealth {
  id: string;
  displayName: string;
  enabled: boolean;
  language: string;
  lastFetch: string | null;
  lastSuccess: string | null;
  errorCount: number;
  lastError: string | null;
  itemCount: number;
}
