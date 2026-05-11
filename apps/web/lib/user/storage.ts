/**
 * Browser-side persistence for the signed-in (or guest) user identity.
 *
 * Mirrors the `tournamental.user.*` localStorage namespace promised in
 * the registration spec — a small set of keys that the AppShell / signup
 * modal / profile page coordinate through. No PII is ever written here:
 * just the opaque user id, public handle, and prompt-skip stickiness.
 *
 * Why localStorage and not cookies (for the v1 dev-mesh window):
 *   - The game service trusts the X-User-Id header today (per docs/13,
 *     real auth lands on top later). Putting the id in localStorage lets
 *     the SPA bracket flow keep working without server-rendered cookies.
 *   - Cookie-based session auth + a server-issued opaque cookie comes
 *     in the follow-up Telegram-JWT PR.
 *
 * Naming convention: `tournamental.user.<key>` for identity, and
 * `tournamental.profile.prompts.<key>` for the contextual-prompt skip
 * stickiness (the progressive enrichment surface).
 */

"use client";

const NS = "tournamental";

const KEY_ID = `${NS}.user.id`;
const KEY_HANDLE = `${NS}.user.handle`;
const KEY_DISPLAY_NAME = `${NS}.user.display_name`;
const KEY_AUTH_METHOD = `${NS}.user.auth_method`;
const KEY_CREATED_AT = `${NS}.user.created_at`;
const KEY_LAST_VISIT_TICK = `${NS}.user.last_visit_tick`;

const PROMPT_PREFIX = `${NS}.profile.prompts`;

export interface LocalUser {
  readonly id: string;
  readonly handle: string;
  readonly display_name?: string | null;
  readonly auth_method?: string | null;
  readonly created_at?: string | null;
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Safari private mode / cross-origin iframe edge cases. Caller falls
    // back to "no user".
    return null;
  }
}

export function getLocalUser(): LocalUser | null {
  const ls = safeStorage();
  if (!ls) return null;
  const id = ls.getItem(KEY_ID);
  const handle = ls.getItem(KEY_HANDLE);
  if (!id || !handle) return null;
  return {
    id,
    handle,
    display_name: ls.getItem(KEY_DISPLAY_NAME) ?? null,
    auth_method: ls.getItem(KEY_AUTH_METHOD) ?? null,
    created_at: ls.getItem(KEY_CREATED_AT) ?? null,
  };
}

export function setLocalUser(user: LocalUser): void {
  const ls = safeStorage();
  if (!ls) return;
  ls.setItem(KEY_ID, user.id);
  ls.setItem(KEY_HANDLE, user.handle);
  if (user.display_name) ls.setItem(KEY_DISPLAY_NAME, user.display_name);
  else ls.removeItem(KEY_DISPLAY_NAME);
  if (user.auth_method) ls.setItem(KEY_AUTH_METHOD, user.auth_method);
  else ls.removeItem(KEY_AUTH_METHOD);
  if (user.created_at) ls.setItem(KEY_CREATED_AT, user.created_at);
  else ls.removeItem(KEY_CREATED_AT);
}

export function clearLocalUser(): void {
  const ls = safeStorage();
  if (!ls) return;
  [
    KEY_ID,
    KEY_HANDLE,
    KEY_DISPLAY_NAME,
    KEY_AUTH_METHOD,
    KEY_CREATED_AT,
    KEY_LAST_VISIT_TICK,
  ].forEach((k) => ls.removeItem(k));
  // Also clear all prompt-skip keys so a re-registered user starts fresh.
  const toRemove: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k && k.startsWith(PROMPT_PREFIX)) toRemove.push(k);
  }
  toRemove.forEach((k) => ls.removeItem(k));
}

// ---------- prompt-skip stickiness ----------

interface PromptRecord {
  readonly status: "skipped" | "completed";
  readonly at: string;
}

function promptKey(name: string): string {
  return `${PROMPT_PREFIX}.${name}`;
}

export function getPromptRecord(name: string): PromptRecord | null {
  const ls = safeStorage();
  if (!ls) return null;
  const raw = ls.getItem(promptKey(name));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PromptRecord;
  } catch {
    return null;
  }
}

export function setPromptRecord(
  name: string,
  status: "skipped" | "completed",
): void {
  const ls = safeStorage();
  if (!ls) return;
  ls.setItem(
    promptKey(name),
    JSON.stringify({ status, at: new Date().toISOString() }),
  );
}

/**
 * A prompt should be shown if it has never been recorded, OR if the
 * skip is older than `cooldownDays`. Completed prompts are never
 * re-shown.
 */
export function shouldShowPrompt(name: string, cooldownDays = 14): boolean {
  const rec = getPromptRecord(name);
  if (!rec) return true;
  if (rec.status === "completed") return false;
  const ageMs = Date.now() - Date.parse(rec.at);
  return ageMs > cooldownDays * 86_400_000;
}

// ---------- session-visit (one POST /visit per browser session) -------

const VISIT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function shouldPostVisit(): boolean {
  const ls = safeStorage();
  if (!ls) return false;
  const last = ls.getItem(KEY_LAST_VISIT_TICK);
  if (!last) return true;
  const ageMs = Date.now() - Number(last);
  return !Number.isFinite(ageMs) || ageMs > VISIT_TTL_MS;
}

export function markVisitPosted(): void {
  const ls = safeStorage();
  if (!ls) return;
  ls.setItem(KEY_LAST_VISIT_TICK, String(Date.now()));
}

// ---------- dataLayer helper ----------

interface DataLayerWindow extends Window {
  dataLayer?: Array<Record<string, unknown>>;
}

/**
 * Push an analytics event onto window.dataLayer. The sister
 * `feat/analytics-tracking-layer` PR will install GA4 on top; our job
 * is to fire the events with stable names so that pipeline has
 * something to bind to.
 */
export function pushDataLayer(event: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const w = window as DataLayerWindow;
  w.dataLayer = w.dataLayer ?? [];
  w.dataLayer.push({ event, ...payload });
}
