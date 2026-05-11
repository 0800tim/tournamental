/**
 * Supabase magic-link / OAuth callback.
 *
 * The user clicks the link in the email; Supabase redirects them here
 * with `?code=<auth_code>`. We exchange the code for a session in the
 * cookie store via the @supabase/ssr helper, then bounce them to the
 * `next` query param (or the bracket page).
 *
 * Also handles pending-invite claim: if `vtorn:auth:pending_invite_v1`
 * is set in localStorage, the client side does the claim on the
 * destination page, this server route just hands them back the
 * session.
 */

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import { serverActionClient } from "@/lib/auth/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/world-cup-2026";

  if (!code) {
    return NextResponse.redirect(new URL("/auth?reason=missing-code", req.url));
  }

  const cookieStore = cookies();
  const sb = serverActionClient({
    get: (name) => {
      const c = cookieStore.get(name);
      return c ? { value: c.value } : undefined;
    },
    set: (name, value, options) =>
      cookieStore.set({ name, value, ...(options as object) }),
    remove: (name, options) =>
      cookieStore.set({ name, value: "", ...(options as object) }),
  });

  if (!sb) {
    return NextResponse.redirect(new URL("/auth?reason=unconfigured", req.url));
  }

  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/auth?reason=${encodeURIComponent(error.message)}`, req.url),
    );
  }
  return NextResponse.redirect(new URL(next, req.url));
}
