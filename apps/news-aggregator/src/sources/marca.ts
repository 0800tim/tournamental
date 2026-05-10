/**
 * Marca (Spanish) — football coverage with strong South-American and
 * Spanish-league reach.
 *
 * Marca publishes RSS at https://e00-marca.uecdn.es/rss/futbol.xml.
 * Their RSS feeds are openly syndicated and the site's footer links
 * to syndication terms; we only display title + capped summary +
 * link out, which is the shape they encourage.
 *
 * Language is `es` — the marketing site filters on `lang=en` by
 * default, so Marca only surfaces when a caller asks for `lang=es` or
 * `lang=any`. Useful for the future Spanish localisation.
 */
import type { SourceDescriptor } from '../types.js';

export const descriptor: SourceDescriptor = {
  id: 'marca',
  displayName: 'Marca',
  homepage: 'https://www.marca.com/futbol.html',
  feedUrl: 'https://e00-marca.uecdn.es/rss/futbol.xml',
  language: 'es',
  defaultTags: ['football', 'es'],
  enabled: true,
  logoUrl: 'https://e00-marca.uecdn.es/assets/v74/img/sprites/sprites-cabecera.svg',
  classify: (title, summary) => {
    const haystack = `${title} ${summary}`.toLowerCase();
    const tags: string[] = [];
    if (
      haystack.includes('mundial') ||
      haystack.includes('copa del mundo') ||
      haystack.includes('world cup') ||
      haystack.includes('2026')
    ) {
      tags.push('world-cup', 'wc2026');
    }
    return tags;
  },
};
