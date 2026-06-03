/**
 * GET /api/v1/profile/syndicates
 *
 * Returns the syndicates associated with the authenticated user. Three
 * resolution paths run in order, first-match wins per slug:
 *
 *   1. Owned by id          (syndicates.owner_user_id = session.userId)
 *   2. Owned by handle slug (membership.role='owner' AND user_id LIKE
 *      'anon:%' AND handle slugifies to the user's display_name slug)
 *      -- this catches pools the user created before the signed-in
 *      flow learned to set owner_user_id (Tim 2026-05-24: the three
 *      pools missing from his My-pools list were all in this bucket).
 *   3. Member via membership table
 *
 * Response: { syndicates: SyndicateListItem[] }
 */

import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { getPersistence } from "@/lib/syndicate/persistence";
import { slugifyDisplayName } from "@/lib/share/handle-slug";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SyndicateListItem {
  slug: string;
  name: string;
  share_guid: string;
  role: "owner" | "member";
  member_count: number;
  tournament_id: string;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

type SyndicateBasicRow = {
  slug: string;
  name: string;
  share_guid: string;
  member_count: number;
  tournament_id: string;
};

type SyndicateBasicRowWithRole = SyndicateBasicRow & { role: string };

/**
 * Resolve the signed-in user's display_name slug + email by forwarding
 * the auth cookie to auth-sms's /v1/auth/me. Used so we can reconcile
 * pools created via the anon-creation path against the user that owns
 * them by handle, and pools where the owner_email matches but
 * owner_user_id was never populated.
 *
 * Best-effort: a network failure or missing fields returns nulls and
 * the listing falls back to the userId-only match.
 */
async function lookupOwnerHintsForUser(
  req: NextRequest,
): Promise<{ handleSlug: string | null; email: string | null }> {
  const base = (
    process.env.AUTH_API_BASE ??
    process.env.AUTH_API_URL ??
    process.env.NEXT_PUBLIC_AUTH_BASE_URL ??
    process.env.NEXT_PUBLIC_AUTH_API_URL ??
    "http://localhost:3330"
  ).replace(/\/+$/, "");
  if (!base) return { handleSlug: null, email: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 500);
  try {
    // SEC-WEB-10: only forward tnm_session to the internal service —
    // not the full cookie jar (analytics / third-party cookies).
    const sessionValue = req.cookies.get("tnm_session")?.value ?? "";
    const res = await fetch(`${base}/v1/auth/me`, {
      signal: ctrl.signal,
      headers: { accept: "application/json", cookie: `tnm_session=${sessionValue}` },
    });
    clearTimeout(timer);
    if (!res.ok) return { handleSlug: null, email: null };
    const body = (await res.json()) as {
      user?: { displayName?: string | null; email?: string | null };
    };
    return {
      handleSlug: slugifyDisplayName(body?.user?.displayName ?? null),
      email: (body?.user?.email ?? null) || null,
    };
  } catch {
    clearTimeout(timer);
    return { handleSlug: null, email: null };
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSessionFromRequest(req);
  if (!session) return json({ error: "no_session" }, 401);

  const userId = session.userId;
  const { handleSlug, email } = await lookupOwnerHintsForUser(req);

  try {
    const { db } = getPersistence();

    // 1) Syndicates the user owns by id.
    const ownedRows = db
      .prepare(
        `SELECT slug, name, share_guid, member_count, tournament_id
         FROM syndicates WHERE owner_user_id = ?`,
      )
      .all(userId) as SyndicateBasicRow[];

    // 1b) Syndicates created via the public signup before the route
    //     learned to set owner_user_id from the session. We trust the
    //     email match here because the user's auth-sms profile email
    //     is itself OTP-verified (so this is a verified-email ==
    //     typed-email comparison, not a free-text claim).
    const ownedByEmailRows = email
      ? (db
          .prepare(
            `SELECT slug, name, share_guid, member_count, tournament_id
             FROM syndicates
             WHERE (owner_user_id IS NULL OR owner_user_id = '')
               AND LOWER(owner_email) = LOWER(?)`,
          )
          .all(email) as SyndicateBasicRow[])
      : [];

    // 2) Anon-owner reconciliation by handle. The membership table
    //    stores a `handle` column on every row; for pools where the
    //    owner created while signed out, user_id starts with `anon:`
    //    and handle holds their typed display_name. SQLite can do
    //    LOWER() + REPLACE() inline so we mirror a coarse subset of
    //    the slugifyDisplayName rule (lowercase, strip spaces/dots/
    //    hyphens) -- exact match would need a callback function we
    //    can't register here, but the coarse match is enough for
    //    the common cases ("0800tim", "Tim Thomas", "Molly Thomas").
    const anonOwnedByHandleRows = handleSlug
      ? (db
          .prepare(
            `SELECT s.slug, s.name, s.share_guid, s.member_count, s.tournament_id
             FROM syndicate_owners_membership m
             JOIN syndicates s ON s.id = m.syndicate_id
             WHERE m.role = 'owner'
               AND m.user_id LIKE 'anon:%'
               AND m.handle IS NOT NULL
               AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(m.handle, ' ', ''), '.', ''), '-', ''), '_', ''))
                   = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(?, ' ', ''), '.', ''), '-', ''), '_', ''))`,
          )
          .all(handleSlug) as SyndicateBasicRow[])
      : [];

    // 3) Direct membership rows.
    const membershipRows = db
      .prepare(
        `SELECT s.slug, s.name, s.share_guid, s.member_count, s.tournament_id, m.role
         FROM syndicate_owners_membership m
         JOIN syndicates s ON s.id = m.syndicate_id
         WHERE m.user_id = ?`,
      )
      .all(userId) as SyndicateBasicRowWithRole[];

    const seen = new Set<string>();
    const syndicates: SyndicateListItem[] = [];

    for (const r of ownedRows) {
      seen.add(r.slug);
      syndicates.push({ ...r, role: "owner" });
    }
    for (const r of ownedByEmailRows) {
      if (!seen.has(r.slug)) {
        seen.add(r.slug);
        syndicates.push({ ...r, role: "owner" });
      }
    }
    for (const r of anonOwnedByHandleRows) {
      if (!seen.has(r.slug)) {
        seen.add(r.slug);
        syndicates.push({ ...r, role: "owner" });
      }
    }
    for (const r of membershipRows) {
      if (!seen.has(r.slug)) {
        seen.add(r.slug);
        syndicates.push({
          slug: r.slug,
          name: r.name,
          share_guid: r.share_guid,
          member_count: r.member_count,
          tournament_id: r.tournament_id,
          role: r.role === "owner" ? "owner" : "member",
        });
      }
    }

    return json({ syndicates });
  } catch {
    return json({ syndicates: [] });
  }
}
