/**
 * /pools — temporarily redirected to /syndicates (Tim 2026-06-01).
 *
 * The original public-pools directory ships an empty-looking grid when the
 * platform has few public pools, which undercuts the "who is using this?"
 * pitch for cold-traffic visitors. Until we have enough public pools that
 * the directory carries its own weight, every /pools landing redirects
 * to /syndicates (the marketing / pricing / how-it-works surface).
 *
 * Sub-routes are unaffected: /pools/playbook (linked from cold-email
 * outreach) and /pools/new (the create-pool flow) keep working because
 * they have their own page.tsx files under app/pools/. Only the exact
 * /pools index is intercepted.
 *
 * Internal nav links to /pools (homepage CTA, app-shell nav, the join-
 * flow country-restricted fallback) all flow through this redirect with
 * one extra hop; no need to chase them down for v1 of the hide.
 *
 * To restore the directory, revert this commit and the listPublic +
 * PoolDirectory code in the same area is still in place.
 */

import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function PoolsPage(): never {
  redirect("/syndicates");
}
