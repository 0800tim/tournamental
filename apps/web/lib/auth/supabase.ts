/**
 * Supabase client factories for the Next.js App Router.
 *
 *   browserClient()       , for "use client" components. Cached at
 *                            module scope so the realtime/auth listeners
 *                            survive route transitions.
 *   serverActionClient()  , for Route Handlers / Server Actions that
 *                            need to read the user's session from cookies.
 *   serviceRoleClient()   , server-only escape hatch that bypasses
 *                            RLS. Use sparingly (admin tasks, trigger
 *                            handlers, friend-graph writes that span
 *                            users).
 *
 * The "guest" path: when `readPublicConfig()` returns `null` we still
 * export the factories but they hand back a stub that mirrors enough of
 * the Supabase surface to keep `useUser()` rendering "guest mode".
 *
 * Reference:
 *   https://supabase.com/docs/guides/auth/server-side/nextjs
 */

import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { readPublicConfig, readServerConfig } from "./config";

type AnyClient = SupabaseClient;

let cachedBrowser: AnyClient | null = null;

/**
 * Browser-side client. Manages the session via cookies (per @supabase/ssr)
 * so server components and route handlers can read it on the same request.
 */
export function browserClient(): AnyClient | null {
  if (typeof window === "undefined") return null;
  if (cachedBrowser) return cachedBrowser;
  const cfg = readPublicConfig();
  if (!cfg) return null;
  cachedBrowser = createBrowserClient(cfg.url, cfg.anonKey);
  return cachedBrowser;
}

/**
 * Server-side client (Route Handlers, Server Actions, RSCs that need
 * the user's session). Caller passes in a `cookies()`-like adapter, we
 * keep the factory signature loose so this module can compile without
 * importing `next/headers` (which would force every consumer onto the
 * server-only edge).
 */
export interface CookieAdapter {
  get: (name: string) => { value: string } | undefined;
  set: (name: string, value: string, options?: Record<string, unknown>) => void;
  remove?: (name: string, options?: Record<string, unknown>) => void;
}

export function serverActionClient(cookies: CookieAdapter): AnyClient | null {
  const cfg = readPublicConfig();
  if (!cfg) return null;
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      get(name: string) {
        return cookies.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        cookies.set(name, value, options);
      },
      remove(name: string, options: Record<string, unknown>) {
        if (cookies.remove) cookies.remove(name, options);
        else cookies.set(name, "", { ...options, maxAge: 0 });
      },
    },
  });
}

/**
 * Service-role client. **Server-only.** Bypasses RLS. Used for:
 *   - the SMS-hook endpoint (read another user's profile to bind a phone)
 *   - the Telegram-bot friend-discovery endpoint (write friendships on
 *     behalf of both parties)
 *   - the auto-provision trigger fallback (when the trigger didn't run)
 */
export function serviceRoleClient(): AnyClient {
  const cfg = readServerConfig();
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
