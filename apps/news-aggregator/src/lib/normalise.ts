/**
 * Turns a raw rss-parser item into a normalised NewsItem. Defensive on
 * every field: feeds in the wild are inconsistent (missing pubDate,
 * HTML in title, summary > 5kb, etc.).
 *
 * We deliberately cap the summary at 240 chars and strip HTML so we
 * never accidentally rehost the source's full article body. The card
 * layout shows the title + 1-2 sentence summary; everything else is a
 * link out.
 */
import type { SourceDescriptor, NewsItem } from '../types.js';
import { NewsItemSchema } from '../types.js';
import { stableId, canonicalUrl } from './hash.js';

const SUMMARY_CAP = 240;

export interface RawRssItem {
  title?: string;
  link?: string;
  guid?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  summary?: string;
  description?: string;
  categories?: string[];
  enclosure?: { url?: string; type?: string };
  // rss-parser exposes media tags via custom fields. We accept either
  // shape (object or string-array) for forward compatibility.
  ['media:thumbnail']?: unknown;
  ['media:content']?: unknown;
  // Some feeds (Guardian, BBC) carry credit on media:credit. We don't
  // currently surface that publicly but we keep the door open.
  ['media:credit']?: unknown;
}

/** Strip tags and collapse whitespace. */
export function stripHtml(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cap a string at `n` chars; ellipsise on a word boundary if possible. */
export function capSummary(input: string, n = SUMMARY_CAP): string {
  if (input.length <= n) return input;
  const slice = input.slice(0, n);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > n * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:!?-]+$/, '')}…`;
}

/**
 * Pick a thumbnail from the various places a feed might park it. Order:
 *   1. media:thumbnail @url
 *   2. media:content @url (image/* only)
 *   3. enclosure (image/* only)
 *   4. inline <img src> in content (last resort)
 *
 * If none of those resolve to an absolute http(s) URL, returns
 * undefined — the UI then falls back to a source-coloured gradient.
 */
export function pickImage(raw: RawRssItem): string | undefined {
  const candidates: string[] = [];

  const thumb = raw['media:thumbnail'];
  if (thumb && typeof thumb === 'object') {
    const t = thumb as { $?: { url?: string }; url?: string } | { $?: { url?: string }; url?: string }[];
    if (Array.isArray(t)) {
      for (const x of t) {
        const u = x?.$?.url ?? x?.url;
        if (u) candidates.push(u);
      }
    } else {
      const u = (t as { $?: { url?: string }; url?: string }).$?.url ?? (t as { url?: string }).url;
      if (u) candidates.push(u);
    }
  }

  const mc = raw['media:content'];
  if (mc && typeof mc === 'object') {
    const arr = Array.isArray(mc) ? mc : [mc];
    for (const x of arr) {
      const o = x as { $?: { url?: string; type?: string }; url?: string; type?: string };
      const u = o?.$?.url ?? o?.url;
      const type = o?.$?.type ?? o?.type;
      if (u && (!type || type.startsWith('image/'))) candidates.push(u);
    }
  }

  if (raw.enclosure?.url && (!raw.enclosure.type || raw.enclosure.type.startsWith('image/'))) {
    candidates.push(raw.enclosure.url);
  }

  if (raw.content) {
    const m = raw.content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (m && m[1]) candidates.push(m[1]);
  }

  for (const c of candidates) {
    try {
      const u = new URL(c);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return u.toString();
      }
    } catch {
      // skip
    }
  }
  return undefined;
}

export interface NormaliseOptions {
  /** Override the publishedAt cutoff if the feed gives an iso8601 in a non-standard slot. */
  fallbackPublishedAt?: string;
}

/**
 * Convert a single raw row to a NewsItem. Returns null if the row is
 * unusable (missing link or title).
 */
export function normaliseItem(
  source: SourceDescriptor,
  raw: RawRssItem,
  opts: NormaliseOptions = {},
): NewsItem | null {
  const title = stripHtml(raw.title ?? '').trim();
  const link = (raw.link ?? '').trim();
  if (!title || !link) return null;

  let url: string;
  try {
    url = new URL(link).toString();
  } catch {
    return null;
  }

  const summarySrc = raw.contentSnippet ?? raw.summary ?? raw.description ?? '';
  const summary = capSummary(stripHtml(summarySrc));

  const isoDate =
    raw.isoDate ??
    (raw.pubDate ? safeIso(raw.pubDate) : undefined) ??
    opts.fallbackPublishedAt ??
    new Date().toISOString();

  const tags = new Set<string>(source.defaultTags);
  if (raw.categories) {
    for (const c of raw.categories) {
      const t = (typeof c === 'string' ? c : '').trim().toLowerCase();
      if (t) tags.add(t);
    }
  }
  if (source.classify) {
    for (const t of source.classify(title, summary)) tags.add(t);
  }

  const image = pickImage(raw);

  const item: NewsItem = {
    id: stableId(source.id, url),
    title,
    summary,
    url: canonicalUrl(url),
    source: source.displayName,
    sourceLogo: source.logoUrl,
    publishedAt: isoDate,
    language: source.language,
    tags: [...tags].sort(),
    imageUrl: image,
  };

  // Validate; if the feed gave us bad data, drop the row.
  const parsed = NewsItemSchema.safeParse(item);
  return parsed.success ? parsed.data : null;
}

function safeIso(s: string): string | undefined {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/**
 * Lightweight WC2026-flavour classifier. Sources can opt into this if
 * they'd like consistent tags without re-implementing the keyword list.
 */
export function inferWorldCupTags(title: string, summary: string): readonly string[] {
  const haystack = `${title} ${summary}`.toLowerCase();
  const tags = new Set<string>();
  if (
    haystack.includes('world cup') ||
    haystack.includes('wc 2026') ||
    haystack.includes('wc2026') ||
    haystack.includes('fifa 2026')
  ) {
    tags.add('world-cup');
    tags.add('wc2026');
  }
  for (const team of [
    'argentina',
    'brazil',
    'france',
    'england',
    'germany',
    'spain',
    'portugal',
    'mexico',
    'usa',
    'canada',
    'morocco',
    'japan',
  ]) {
    if (haystack.includes(team)) tags.add(`team:${team}`);
  }
  return [...tags];
}
