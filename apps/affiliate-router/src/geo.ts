/**
 * Country resolution for affiliate gating.
 *
 * Order of precedence:
 *   1. `cf-ipcountry` request header (Cloudflare-injected, the production path).
 *   2. `?country=` query string (dev / explicit override).
 *   3. `null` — caller decides whether to 4xx or fall back.
 *
 * We deliberately do NOT trust the IP itself — we let Cloudflare resolve it.
 * Outside Cloudflare, callers must pass `?country=` explicitly (dev only).
 */

import type { FastifyRequest } from 'fastify';

/** ISO-3166-1 alpha-2 (uppercase). */
export type Iso2 = string;

const ISO2_RE = /^[A-Z]{2}$/;

/** Accepts a string and returns it normalised, or null if not a valid ISO2. */
export function normaliseCountry(input: string | undefined | null): Iso2 | null {
  if (!input) return null;
  const v = input.trim().toUpperCase();
  if (!ISO2_RE.test(v)) return null;
  // CF returns 'XX' for unknown / Tor / private addresses — treat as unknown.
  if (v === 'XX' || v === 'T1') return null;
  return v;
}

export function resolveCountry(req: {
  headers: Record<string, string | string[] | undefined>;
  query: unknown;
}): Iso2 | null {
  const cfRaw = req.headers['cf-ipcountry'];
  const cfStr = Array.isArray(cfRaw) ? cfRaw[0] : cfRaw;
  const fromCf = normaliseCountry(cfStr ?? null);
  if (fromCf) return fromCf;

  const q = (req.query ?? {}) as { country?: string };
  return normaliseCountry(q.country ?? null);
}

/** Fastify-typed wrapper. */
export function resolveCountryFromReq(req: FastifyRequest): Iso2 | null {
  return resolveCountry({
    headers: req.headers as Record<string, string | string[] | undefined>,
    query: req.query,
  });
}
