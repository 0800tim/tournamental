/**
 * /dashboard/syndicates/[slug] — owner-only management screen for a
 * single syndicate.
 *
 * Renders: tier, member count, embed snippet (with copy-to-clipboard),
 * public-landing link, leaderboard preview, tier-aware actions
 * (upgrade-to-premium CTA for free; deep-link into HighLevel for
 * premium), and the "manage in CRM" handoff once premium is active.
 *
 * Auth: server-side via the owner-scoped GET /api/v1/syndicates/[slug]/owner
 * endpoint, which returns 403 for non-owners. The page itself is
 * scaffolded server-side and the client component handles the auth
 * states (loading / unauth / forbidden / ready) for the same reason
 * the list page does.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

import { SyndicateManageView } from "./SyndicateManageView";
import "../dashboard.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage syndicate · Tournamental",
};

export default async function SyndicateManagePage(
  props: {
    params: Promise<{ slug: string }>;
  }
): Promise<JSX.Element> {
  const params = await props.params;
  return (
    <AppShell title="Manage syndicate">
      <SyndicateManageView slug={params.slug} />
    </AppShell>
  );
}
