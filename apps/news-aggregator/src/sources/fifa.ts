/**
 * FIFA's official news.
 *
 * FIFA does not currently publish a stable public RSS feed at a
 * documented URL — the site uses a Next.js JSON API instead. We
 * register the source disabled-by-default; an operator can flip
 * `NEWS_ENABLE_FIFA=1` to enable it once we have a confirmed
 * machine-readable feed (or a syndication partnership).
 *
 * In the meantime the source still appears in /v1/sources so the UI
 * can show it as "coming soon" rather than 404.
 */
import type { SourceDescriptor } from '../types.js';
import { inferWorldCupTags } from '../lib/normalise.js';

export const descriptor: SourceDescriptor = {
  id: 'fifa',
  displayName: 'FIFA',
  homepage: 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026',
  // Placeholder; flip enabled=true once we have a confirmed feed URL
  // (or replace this with a JSON ingestor).
  feedUrl: 'https://www.fifa.com/rss/news.xml',
  language: 'en',
  defaultTags: ['football', 'fifa', 'official'],
  enabled: process.env.NEWS_ENABLE_FIFA === '1',
  logoUrl: 'https://digitalhub.fifa.com/transform/fifaLogo.svg',
  classify: (title, summary) => [...inferWorldCupTags(title, summary), 'wc2026'],
};
