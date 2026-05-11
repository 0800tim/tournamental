/**
 * /i/<code>, invite-claim landing.
 *
 * Flow:
 *   1. Server reads the invite code, marks it as claimed if the user
 *      is already signed in (writes the friendship row via the
 *      service-role client).
 *   2. If unauthenticated, the server sets a cookie with the code and
 *      bounces to /world-cup-2026?invited=1. The next sign-in attempts
 *      to claim the code via the auth callback handler.
 *
 * We deliberately don't render any UI here, the user expects to land
 * on the bracket, not a confirmation page.
 */

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";

import { serverActionClient, serviceRoleClient } from "@/lib/auth/supabase";
import { readPublicConfig } from "@/lib/auth/config";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: { code: string };
}

export default async function ClaimInvite({ params }: PageProps) {
  const code = (params.code || "").toLowerCase().slice(0, 16);
  if (!code) redirect("/world-cup-2026");

  const cfg = readPublicConfig();
  if (!cfg) {
    // Without Supabase wired, just bounce to the bracket, invite
    // attribution will pick up post-deploy when env vars land.
    redirect("/world-cup-2026?invited=1");
  }

  const cookieStore = cookies();
  const _headers = headers();
  void _headers;

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

  if (!sb) redirect("/world-cup-2026?invited=1");

  // Server-side: who is the logged-in user (if any)?
  const { data: userData } = await sb.auth.getUser();
  const user = userData?.user;

  // Always stash the code as a cookie so the next sign-in can claim it.
  cookieStore.set({
    name: "vtorn_pending_invite",
    value: code,
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
    sameSite: "lax",
  });

  if (!user) {
    redirect("/world-cup-2026?invited=1");
  }

  // Authenticated → attempt to claim immediately.
  try {
    const admin = serviceRoleClient();
    const { data: invite } = await admin
      .from("invite_codes")
      .select("code, user_id, claimed_by, expires_at")
      .eq("code", code)
      .maybeSingle();
    if (invite && !invite.claimed_by && new Date(invite.expires_at) > new Date()) {
      // Mark claimed.
      await admin
        .from("invite_codes")
        .update({ claimed_by: user.id, claimed_at: new Date().toISOString() })
        .eq("code", code);
      // Mutual friendship rows. user_id is the inviter; user.id is the claimer.
      if (invite.user_id !== user.id) {
        await admin.from("friendships").upsert(
          [
            {
              user_id: invite.user_id,
              friend_id: user.id,
              source: "whatsapp_invite",
            },
            {
              user_id: user.id,
              friend_id: invite.user_id,
              source: "whatsapp_invite",
            },
          ],
          { onConflict: "user_id,friend_id" },
        );
      }
    }
  } catch {
    // Best-effort; missing service-role config will throw, that's a
    // dev-env issue, not user-facing.
  }

  redirect("/world-cup-2026?invited=1");
}
