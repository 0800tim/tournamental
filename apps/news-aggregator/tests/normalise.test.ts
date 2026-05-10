/**
 * Normaliser unit tests. Covers:
 *   - missing fields are tolerated (returns null when truly unusable)
 *   - HTML in title/summary is stripped
 *   - summary cap respects the 240-char limit, snaps to a word
 *   - thumbnails resolve from media:thumbnail / media:content / enclosure
 *   - default tags + classify() are merged into the item's tags
 */
import { describe, it, expect } from 'vitest';

import { normaliseItem, capSummary, stripHtml, pickImage, inferWorldCupTags } from '../src/lib/normalise.js';
import type { SourceDescriptor } from '../src/types.js';

const stubSource: SourceDescriptor = {
  id: 'stub',
  displayName: 'Stub Source',
  homepage: 'https://example.com',
  feedUrl: 'https://example.com/feed.xml',
  language: 'en',
  defaultTags: ['football'],
  enabled: true,
  classify: (t, s) => inferWorldCupTags(t, s),
};

describe('stripHtml', () => {
  it('removes tags and decodes entities', () => {
    expect(stripHtml('<p>Hello &amp; <strong>world</strong></p>')).toBe('Hello & world');
  });
  it('handles undefined/null', () => {
    expect(stripHtml(undefined)).toBe('');
    expect(stripHtml(null)).toBe('');
  });
  it('collapses whitespace', () => {
    expect(stripHtml('  foo\n\n  bar   ')).toBe('foo bar');
  });
});

describe('capSummary', () => {
  it('returns the input untouched when short', () => {
    expect(capSummary('a short summary')).toBe('a short summary');
  });
  it('caps at 240 chars by default', () => {
    const long = 'word '.repeat(100);
    const out = capSummary(long);
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.endsWith('…')).toBe(true);
  });
  it('snaps to a word boundary when one is reasonably close', () => {
    const text = 'Lorem ipsum dolor sit amet consectetur adipiscing elit';
    const out = capSummary(text, 30);
    expect(out).not.toContain('cons…');
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('pickImage', () => {
  it('prefers media:thumbnail', () => {
    const img = pickImage({
      'media:thumbnail': { $: { url: 'https://cdn.example.com/a.jpg' } },
      'media:content': { $: { url: 'https://cdn.example.com/b.jpg', type: 'image/jpeg' } },
    });
    expect(img).toBe('https://cdn.example.com/a.jpg');
  });
  it('falls through to media:content', () => {
    const img = pickImage({
      'media:content': { $: { url: 'https://cdn.example.com/b.jpg', type: 'image/jpeg' } },
    });
    expect(img).toBe('https://cdn.example.com/b.jpg');
  });
  it('skips media:content when type is not image/*', () => {
    const img = pickImage({
      'media:content': { $: { url: 'https://cdn.example.com/audio.mp3', type: 'audio/mpeg' } },
      enclosure: { url: 'https://cdn.example.com/c.png', type: 'image/png' },
    });
    expect(img).toBe('https://cdn.example.com/c.png');
  });
  it('falls back to inline <img src> in content', () => {
    const img = pickImage({
      content: '<p>hello</p><img src="https://cdn.example.com/inline.jpg" alt="x" />',
    });
    expect(img).toBe('https://cdn.example.com/inline.jpg');
  });
  it('returns undefined when nothing usable', () => {
    expect(pickImage({})).toBeUndefined();
    expect(pickImage({ 'media:thumbnail': { $: { url: 'data:image/png;base64,xxx' } } })).toBeUndefined();
  });
});

describe('normaliseItem', () => {
  it('returns null when title or link is missing', () => {
    expect(normaliseItem(stubSource, { title: '', link: 'https://x.test' })).toBeNull();
    expect(normaliseItem(stubSource, { title: 'X', link: '' })).toBeNull();
  });

  it('builds a valid NewsItem from minimal fields', () => {
    const item = normaliseItem(stubSource, {
      title: 'Argentina win World Cup qualifier',
      link: 'https://example.com/argentina-qualifier',
      description: 'A short description here.',
      pubDate: 'Sun, 11 May 2026 06:32:00 GMT',
    });
    expect(item).not.toBeNull();
    expect(item!.id.startsWith('stub-')).toBe(true);
    expect(item!.url).toBe('https://example.com/argentina-qualifier');
    expect(item!.source).toBe('Stub Source');
    expect(item!.language).toBe('en');
    expect(item!.tags).toContain('football');
    // classify() should pick up Argentina + World Cup intent
    expect(item!.tags).toContain('team:argentina');
  });

  it('strips HTML from description', () => {
    const item = normaliseItem(stubSource, {
      title: 'Title',
      link: 'https://example.com/x',
      description: '<p>HTML <strong>inside</strong></p>',
      pubDate: 'Sun, 11 May 2026 06:32:00 GMT',
    });
    expect(item!.summary).toBe('HTML inside');
  });

  it('canonicalises tracking params out of the URL', () => {
    const item = normaliseItem(stubSource, {
      title: 'Title',
      link: 'https://example.com/x?utm_source=rss&utm_medium=feed&id=42',
      pubDate: 'Sun, 11 May 2026 06:32:00 GMT',
    });
    expect(item!.url).toBe('https://example.com/x?id=42');
  });

  it('falls back to now() when pubDate is missing', () => {
    const before = Date.now();
    const item = normaliseItem(stubSource, {
      title: 'Title',
      link: 'https://example.com/x',
    });
    expect(item).not.toBeNull();
    expect(Date.parse(item!.publishedAt)).toBeGreaterThanOrEqual(before - 100);
  });

  it('rejects rows with malformed URLs', () => {
    const item = normaliseItem(stubSource, {
      title: 'Title',
      link: 'not-a-url',
    });
    expect(item).toBeNull();
  });
});

describe('inferWorldCupTags', () => {
  it('tags world-cup mentions', () => {
    expect(inferWorldCupTags('England prepare for World Cup', '')).toContain('world-cup');
    expect(inferWorldCupTags('WC2026 update', '')).toContain('wc2026');
  });
  it('tags well-known team names', () => {
    expect(inferWorldCupTags('Argentina vs Brazil friendly', '')).toContain('team:argentina');
    expect(inferWorldCupTags('Argentina vs Brazil friendly', '')).toContain('team:brazil');
  });
  it('returns empty when no match', () => {
    expect(inferWorldCupTags('A very generic story', '')).toEqual([]);
  });
});
