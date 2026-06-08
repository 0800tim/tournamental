/**
 * Browser-swarm debug logger.
 *
 * Verbose console output in development, no-op in production. Wraps
 * console.log / console.warn so we don't leak generation chatter into
 * end-user devtools at prod scale (a billion-bot operator would see
 * 100k log lines per minute otherwise).
 *
 * Toggle: NEXT_PUBLIC_BROWSER_SWARM_DEBUG=1 forces logs on in any env.
 */

const FORCE_ON =
  typeof process !== "undefined" &&
  process.env?.NEXT_PUBLIC_BROWSER_SWARM_DEBUG === "1";

const IS_DEV =
  typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

const ENABLED = FORCE_ON || IS_DEV;

export function debug(...args: unknown[]): void {
  if (!ENABLED) return;
  // eslint-disable-next-line no-console
  console.log("[browser-swarm]", ...args);
}

export function warn(...args: unknown[]): void {
  if (!ENABLED) return;
  // eslint-disable-next-line no-console
  console.warn("[browser-swarm]", ...args);
}

/** Always logs, regardless of env. Use sparingly for genuine errors. */
export function error(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error("[browser-swarm]", ...args);
}
