/**
 * BBC Sport football RSS.
 *
 * Public feed. BBC's robots.txt allows /sport/ paths and the RSS
 * itself is documented at https://www.bbc.co.uk/news/10628494 as
 * intended for syndication, including third-party readers, provided
 * the link points back to the original article.
 *
 * We comply: title + capped summary + link out only.
 */
import type { SourceDescriptor } from '../types.js';
import { inferWorldCupTags } from '../lib/normalise.js';

export const descriptor: SourceDescriptor = {
  id: 'bbc',
  displayName: 'BBC Sport',
  homepage: 'https://www.bbc.co.uk/sport/football',
  feedUrl: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
  language: 'en',
  defaultTags: ['football'],
  enabled: true,
  logoUrl: 'https://nav.files.bbci.co.uk/orbit/61617f164ed1eee8c3d23b6d0a0eaeae/img/blq-orbit-blocks_grey.svg',
  classify: (title, summary) => inferWorldCupTags(title, summary),
};
