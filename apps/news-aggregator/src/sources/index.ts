/**
 * Re-export every source's descriptor in a stable order so the public
 * /v1/sources endpoint always returns the same shape.
 *
 * Adding a new source: drop a file in this directory exporting a
 * `descriptor: SourceDescriptor`, then add it to the array below.
 */
import type { SourceDescriptor } from '../types.js';

import { descriptor as bbc } from './bbc.js';
import { descriptor as espn } from './espn.js';
import { descriptor as fifa } from './fifa.js';
import { descriptor as goal } from './goal.js';
import { descriptor as marca } from './marca.js';
import { descriptor as theguardian } from './theguardian.js';

export const ALL_SOURCES: readonly SourceDescriptor[] = [
  bbc,
  theguardian,
  espn,
  fifa,
  goal,
  marca,
];

export function enabledSources(): readonly SourceDescriptor[] {
  return ALL_SOURCES.filter((s) => s.enabled);
}
