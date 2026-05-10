/**
 * Goal.com — football news.
 *
 * Goal.com does not publish a transparent RSS feed and their
 * robots.txt is restrictive on programmatic scraping. We list the
 * source disabled-by-default and document the ambiguity so a future
 * operator can add it via a partnership API instead. Until then the
 * /v1/sources endpoint shows Goal as a "configured-but-disabled"
 * source.
 */
import type { SourceDescriptor } from '../types.js';
import { inferWorldCupTags } from '../lib/normalise.js';

export const descriptor: SourceDescriptor = {
  id: 'goal',
  displayName: 'Goal.com',
  homepage: 'https://www.goal.com/en/news/world-cup-2026',
  // Placeholder — see docs/49-news-aggregator.md for the licensing
  // ambiguity. Operators can flip NEWS_ENABLE_GOAL=1 if they have a
  // syndication agreement and a working feed URL.
  feedUrl: 'https://www.goal.com/feeds/en/news',
  language: 'en',
  defaultTags: ['football'],
  enabled: process.env.NEWS_ENABLE_GOAL === '1',
  classify: (title, summary) => inferWorldCupTags(title, summary),
};
