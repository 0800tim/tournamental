/**
 * /dashboard/syndicates — affiliate dashboard for syndicate owners.
 *
 * Lists every syndicate the signed-in user owns, with tier + member
 * count + quick actions (manage, view public landing, copy embed
 * snippet, upgrade to premium). The page is intentionally minimal in
 * its first revision; per-syndicate management screens land as
 * separate routes once this proves out.
 *
 * Auth: client-side via `useUser()` for the loading state, then the
 * server-side `GET /api/v1/syndicates/mine` endpoint enforces the real
 * session check. If the user isn't signed in we render the
 * "sign in to manage your syndicates" empty state with a prominent
 * sign-in CTA that opens the existing SignupModal.
 *
 * Cache policy: this is a per-user page; the Next.js layout already
 * sets `Cache-Control: private, no-store` on the API. The page shell
 * is statically renderable; the data is fetched client-side after
 * mount.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

import { SyndicatesDashboard } from "./SyndicatesDashboard";
import "./dashboard.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your syndicates · Tournamental",
  description:
    "Manage the syndicates you've created on Tournamental. View members, leaderboards, embed snippets, and upgrade to premium.",
};

export default function SyndicatesDashboardPage(): JSX.Element {
  return (
    <AppShell title="Your syndicates">
      <SyndicatesDashboard />
    </AppShell>
  );
}
