/**
 * ESPN soccer RSS.
 *
 * ESPN syndicates RSS at https://www.espn.com/espn/rss/soccer/news.
 * Their syndication terms (https://www.espn.com/espn/help/index?topic=syndication)
 * permit third-party display of headlines + brief excerpts that link
 * back to ESPN's article — exactly what we do.
 */
import type { SourceDescriptor } from '../types.js';
import { inferWorldCupTags } from '../lib/normalise.js';

export const descriptor: SourceDescriptor = {
  id: 'espn',
  displayName: 'ESPN',
  homepage: 'https://www.espn.com/soccer/',
  feedUrl: 'https://www.espn.com/espn/rss/soccer/news',
  language: 'en',
  defaultTags: ['football', 'soccer'],
  enabled: true,
  logoUrl: 'https://a.espncdn.com/redesign/assets/img/logos/espn-404.png',
  classify: (title, summary) => inferWorldCupTags(title, summary),
};
