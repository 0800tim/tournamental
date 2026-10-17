/**
 * Security headers for apps/web (every host mode: live, hub, archive).
 *
 * Plain ESM so `next.config.mjs` can import it without a TypeScript
 * loader and vitest can test the exact strings that ship.
 *
 * What is enforced today:
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Permissions-Policy: camera, microphone, geolocation, payment and
 *     USB all denied (nothing in the app asks for them).
 *   - Framing: `frame-ancestors 'none'` plus `X-Frame-Options: DENY`
 *     on ordinary pages. The embed widget frames the bracket at
 *     `/world-cup-2026?embed=1` from partner sites and `/embed/*`
 *     carries the widget script and its get-code page, so those two
 *     shapes get no framing restriction.
 *
 * What is report-only (nothing is blocked yet): a Content Security
 * Policy sized for the current app. It allows the GTM bootstrap in
 * `components/analytics/GtmRoot.tsx` (inline script, googletagmanager
 * script and iframe), the 3D renderer and browser-swarm workers
 * (`blob:`), the auth-sms, odds and game origins for fetches, and the
 * live producer over WebSocket. Watch the browser console on the hub
 * and the archive for a week, then move `script-src` to a nonce and
 * promote the policy to enforcing. There is no report endpoint yet,
 * so violations only show in devtools.
 *
 * HSTS is deliberately not set here: Cloudflare fronts every hostname
 * and the zone-level HSTS setting covers them all (docs/33).
 */

const FIRST_PARTY_CONNECT = [
  "https://auth.tournamental.com",
  "https://odds.tournamental.com",
  "https://game.tournamental.com",
  "wss://stream.tournamental.com",
];

const ANALYTICS_SCRIPT = ["https://www.googletagmanager.com", "https://www.google-analytics.com"];
const ANALYTICS_CONNECT = [
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://www.googletagmanager.com",
  "https://*.analytics.google.com",
];
const AVATAR_IMG = ["https://api.dicebear.com"];

/**
 * Build the report-only CSP. `extraConnect` lets the config add the
 * odds proxy from NEXT_PUBLIC_ODDS_API_URL when it is a different host.
 * @param {{ dev?: boolean, extraConnect?: readonly string[] }} [opts]
 */
export function contentSecurityPolicy(opts = {}) {
  const dev = opts.dev ?? false;
  const extra = (opts.extraConnect ?? []).filter(Boolean);
  const scriptSrc = ["'self'", "'unsafe-inline'", "blob:", ...ANALYTICS_SCRIPT];
  // Next's dev runtime evaluates code at runtime; production bundles do not.
  if (dev) scriptSrc.push("'unsafe-eval'");
  const directives = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["worker-src", ["'self'", "blob:"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["media-src", ["'self'", "blob:", "https:"]],
    ["connect-src", ["'self'", ...FIRST_PARTY_CONNECT, ...ANALYTICS_CONNECT, ...AVATAR_IMG, ...extra, ...(dev ? ["ws:", "http://localhost:*", "http://127.0.0.1:*"] : [])]],
    ["frame-src", ["'self'", "https://www.googletagmanager.com"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'", "https://auth.tournamental.com"]],
  ];
  return directives.map(([name, values]) => `${name} ${[...new Set(values)].join(" ")}`).join("; ");
}

/** Headers every response gets, whatever the host mode. */
export function baseSecurityHeaders(opts = {}) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy(opts) },
  ];
}

/** Added on pages that must never be framed (everything except the embed). */
export const NO_FRAMING_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

/**
 * Is this request shape allowed inside a partner iframe?
 * Mirrors the `has` / `missing` conditions in `securityHeaderRules()`.
 * @param {{ path: string, query?: Record<string, string | undefined> }} req
 */
export function framingAllowed(req) {
  if (req.path === "/embed" || req.path.startsWith("/embed/")) return true;
  return req.query?.embed === "1";
}

/**
 * The `headers()` entries for next.config.mjs.
 * Rule order matters only for readability; Next applies every matching
 * rule and later values do not override earlier ones for the same key,
 * so the framing headers live in their own exclusive rules.
 * @param {{ dev?: boolean, extraConnect?: readonly string[] }} [opts]
 */
export function securityHeaderRules(opts = {}) {
  const base = baseSecurityHeaders(opts);
  return [
    // Everything: nosniff, referrer, permissions, report-only CSP.
    { source: "/:path*", headers: base },
    // Ordinary pages outside /embed and without ?embed=1: no framing.
    {
      source: "/:path((?!embed(?:/|$)).*)",
      missing: [{ type: "query", key: "embed", value: "1" }],
      headers: NO_FRAMING_HEADERS,
    },
  ];
}

/**
 * Resolve the full header set for a request the way Next would, for
 * tests and for curl comparisons: base headers always, framing headers
 * unless `framingAllowed`.
 * @param {{ path: string, query?: Record<string, string | undefined> }} req
 */
export function headersFor(req, opts = {}) {
  const out = [...baseSecurityHeaders(opts)];
  if (!framingAllowed(req)) out.push(...NO_FRAMING_HEADERS);
  return out;
}
