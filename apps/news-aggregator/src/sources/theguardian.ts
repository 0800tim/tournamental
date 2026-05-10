/**
 * The Guardian football RSS.
 *
 * Guardian publishes a public RSS feed at
 * https://www.theguardian.com/football/rss. Their syndication policy
 * (https://syndication.theguardian.com/) explicitly permits
 * non-commercial reuse of headlines + brief summaries with attribution
 * and a link back to the source article. That's our shape.
 */
import type { SourceDescriptor } from '../types.js';
import { inferWorldCupTags } from '../lib/normalise.js';

export const descriptor: SourceDescriptor = {
  id: 'theguardian',
  displayName: 'The Guardian',
  homepage: 'https://www.theguardian.com/football',
  feedUrl: 'https://www.theguardian.com/football/rss',
  language: 'en',
  defaultTags: ['football'],
  enabled: true,
  logoUrl: 'https://assets.guim.co.uk/images/favicons/46bd2faa1ee7ee21f7c74d51a0a30d4d/152x152.png',
  classify: (title, summary) => inferWorldCupTags(title, summary),
};
