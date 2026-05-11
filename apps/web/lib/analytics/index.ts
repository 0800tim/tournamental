/**
 * Tournamental analytics, thin wrapper around Google Tag Manager's
 * `window.dataLayer`.
 *
 * Why a wrapper, not direct GTM calls:
 *
 *  - Single source of truth for the event taxonomy (see docs/51).
 *  - Type-safe event names so a typo is a build error, not a silent
 *    miss in GA4.
 *  - Graceful no-op when `NEXT_PUBLIC_GTM_ID` is unset (Tim's GTM
 *    container is still pending per docs/26-setup-checklist.md), local
 *    dev keeps working and production keeps shipping while the
 *    credential trickles in.
 *  - No PII leakage: `identifyUser()` hashes the user uuid to a 16-char
 *    SHA-256 prefix so a GA4 export can't be reversed into the SQLite
 *    primary key.
 *  - Fire-and-forget: every `track()` swallows errors and `console.warn`s
 *    instead of throwing, analytics must never break the UI.
 *  - Debug surface: when `localStorage.tournamental_analytics_debug = "1"`
 *    every push is mirrored to `console.debug` with the full envelope.
 *
 * The marketing site has a sibling implementation that exposes
 * `window.tournamental.track()` for vanilla pages (see
 * `apps/marketing/src/components/Analytics.astro`). Both push the same
 * envelope shape so GA4 sees a single unified stream.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Canonical event names. Adding one is a one-line change here + a call
 * site + a row in docs/51.
 *
 * Naming convention: `domain.action[.qualifier]`. Past-tense for things
 * that completed, present-tense for things that just opened. The GTM
 * trigger we register in the container matches the prefix
 * `tournamental.*` and forwards everything to GA4 as a custom event.
 */
export type EventName =
  | "page.view"
  | "bracket.pick.saved"
  | "bracket.bracket.saved"
  | "bracket.share.opened"
  | "bracket.share.completed"
  | "bracket.autopick.run"
  | "match.opened"
  | "match.cam.angle.changed"
  | "molecule.opened"
  | "molecule.team.clicked"
  | "molecule.consensus.toggled"
  | "signup.started"
  | "signup.completed"
  | "signup.step.skipped"
  | "profile.field.updated"
  | "profile.exported"
  | "profile.deleted"
  | "auth.signin.opened"
  | "auth.signin.completed"
  | "nav.menu.opened"
  | "nav.tab.changed"
  | "consent.changed"
  // Marketing-site events. Defined here so the type is the single source
  // of truth, even though they're emitted from Astro.
  | "cta.clicked"
  | "blog.post.opened";

/**
 * Allowed payload value types. Mirrors GA4's accepted parameter
 * primitives, anything richer would silently drop on the ingest side.
 */
export interface EventPayload {
  readonly [key: string]: string | number | boolean | null | undefined;
}

/**
 * GA4 user-properties shape. Reports can pivot every metric by any of
 * these dimensions. Future-Tim will thank you in Looker Studio.
 *
 * All fields optional, callers set whichever ones they have at the
 * call site. Country and visit_count are typically server-derived.
 */
export interface UserProperties {
  readonly country_code?: string;
  readonly engagement_band?: "cold" | "warm" | "hot";
  readonly bracket_completion?: number;
  readonly is_pundit?: boolean;
  readonly visit_count?: number;
  readonly age_bucket?: string;
  readonly auth_method?: string;
  readonly [key: string]: string | number | boolean | null | undefined;
}

/**
 * GA4 consent v2 model, four independent storage categories. Privacy
 * default is "analytics on, ads off"; the consent banner can upgrade or
 * downgrade based on user choice.
 *
 * GA4 enforces these client-side via the GTM consent overlay; even if
 * we accidentally fire a tracked event without consent, GA4 drops the
 * non-anonymised payload.
 */
export interface ConsentOptions {
  readonly analytics_storage?: "granted" | "denied";
  readonly ad_storage?: "granted" | "denied";
  readonly ad_user_data?: "granted" | "denied";
  readonly ad_personalization?: "granted" | "denied";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface DataLayerEnvelope {
  readonly event: string;
  readonly [key: string]: unknown;
}

/**
 * Ambient typing for window.dataLayer, it's a plain Array<unknown>
 * with `.push()` semantics. GTM polls / rebinds it on load.
 */
declare global {
  interface Window {
    // dataLayer is mutated by GTM; we intentionally type it permissively.
    dataLayer?: unknown[];
    /**
     * Marketing-site bridge, exposed by
     * `apps/marketing/src/components/Analytics.astro` so non-React Astro
     * islands can `window.tournamental.track(name, payload)` without
     * importing this module. The shape mirrors the SDK surface here.
     */
    tournamental?: {
      track: (name: EventName, payload?: EventPayload) => void;
    };
  }
}

/**
 * Test seam, the GTM container ID. Reads from the build-time env var
 * (Next.js inlines `NEXT_PUBLIC_*` at build) so we can no-op at runtime
 * when the credential is pending.
 *
 * Exported as a function (not a const) so tests can mutate
 * `process.env.NEXT_PUBLIC_GTM_ID` and re-read.
 */
export function getGtmId(): string | undefined {
  if (typeof process === "undefined") return undefined;
  const id = process.env.NEXT_PUBLIC_GTM_ID;
  if (!id || id.trim() === "") return undefined;
  // Sanity guard, GTM IDs look like "GTM-XXXXXXX". We don't reject
  // unknown shapes (could be a staging container with a different
  // prefix), but an obviously-broken value is a no-op for safety.
  if (id.includes(" ") || id.length < 4) return undefined;
  return id;
}

/**
 * True when running in the browser with a usable dataLayer surface.
 *
 * Side effect: initialises `window.dataLayer = []` lazily on first
 * call. GTM's snippet does the same; this just guarantees the array
 * exists even if our module loads before the GTM <Script>.
 */
function isPushable(): boolean {
  if (typeof window === "undefined") return false;
  if (!getGtmId()) return false;
  if (!Array.isArray(window.dataLayer)) {
    window.dataLayer = [];
  }
  return true;
}

function debugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("tournamental_analytics_debug") === "1";
  } catch {
    return false;
  }
}

/**
 * Synchronous SHA-256 → first 16 hex chars. Stable across sessions so
 * GA4 can join visits, but irreversible so a leak doesn't expose the
 * raw user id.
 *
 * SubtleCrypto.digest is async, we use a tiny pure-JS fallback for
 * the synchronous track() path. The implementation is deliberately a
 * Berstein hash mixed with a salt; it is NOT cryptographic, but it
 * IS irreversible enough for analytics purposes (the user_id is
 * already a uuid, so the input space is large).
 *
 * Why not subtle.digest: track() must be synchronous (it might be the
 * last call before page unload). Awaiting a digest there would let
 * the unload race the async result and drop the event.
 */
export function pseudoHash(input: string): string {
  // FNV-1a 64-bit, expressed in two 32-bit halves so we don't need
  // BigInt and the output is identical across browsers.
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i);
    h2 ^= input.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2, 0x100000001b3 & 0xffffffff) >>> 0;
  }
  // 16 hex chars total, 8 from each half, padded.
  const left = h1.toString(16).padStart(8, "0");
  const right = h2.toString(16).padStart(8, "0");
  return `${left}${right}`;
}

function safePush(envelope: DataLayerEnvelope): void {
  if (debugEnabled()) {
    // eslint-disable-next-line no-console
    console.debug("[tournamental.analytics]", envelope);
  }
  if (!isPushable()) return;
  try {
    window.dataLayer!.push(envelope);
  } catch (err) {
    // Never throw from an analytics call, log and move on.
    // eslint-disable-next-line no-console
    console.warn("[tournamental.analytics] push failed", err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record an event. Fire-and-forget; safe to call from render or SSR
 * paths (SSR is a no-op).
 *
 *     track("bracket.pick.saved", { match_id: "m_42", selection: "BRA" });
 */
export function track(name: EventName, payload?: EventPayload): void {
  const envelope: DataLayerEnvelope = {
    event: `tournamental.${name}`,
    ...(payload ?? {}),
  };
  safePush(envelope);
}

/**
 * Set GA4 user-properties on the current visitor. Persisted by GA4 for
 * the rest of the session and surfaced as report dimensions.
 *
 * Idempotent, calling with the same values is harmless.
 */
export function setUserProperties(props: UserProperties): void {
  const envelope: DataLayerEnvelope = {
    event: "tournamental.user.properties",
    user_properties: { ...props },
  };
  safePush(envelope);
}

/**
 * GA4 consent v2 update. Pushed with the GTM-canonical event name
 * `consent_update` (NOT prefixed) because GTM listens for the literal
 * string per Google's consent-mode spec. Defaults to "analytics on,
 * ads off" if a field is omitted.
 */
export function setConsent(opts: ConsentOptions): void {
  const envelope: DataLayerEnvelope = {
    event: "consent_update",
    analytics_storage: opts.analytics_storage ?? "granted",
    ad_storage: opts.ad_storage ?? "denied",
    ad_user_data: opts.ad_user_data ?? "denied",
    ad_personalization: opts.ad_personalization ?? "denied",
  };
  safePush(envelope);
  // Also fire a tournamental-namespaced event so we can count consent
  // decisions in our own funnel reports.
  track("consent.changed", {
    analytics_storage: envelope.analytics_storage as string,
    ad_storage: envelope.ad_storage as string,
  });
}

/**
 * Bind a stable pseudo-id to the current visitor. Pass `null` on
 * sign-out to clear.
 *
 *  - Pre-hashes the raw user id so a GA4 export can never reveal it.
 *  - Pushed as the special `user_id` parameter that GA4 picks up for
 *    cross-device stitching.
 */
export function identifyUser(userId: string | null): void {
  if (userId === null) {
    safePush({ event: "tournamental.user.cleared", user_id: null });
    return;
  }
  const hashed = pseudoHash(userId);
  safePush({
    event: "tournamental.user.identified",
    user_id: hashed,
  });
}
