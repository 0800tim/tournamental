/**
 * /dashboard/pools/[slug] — alias for /dashboard/syndicates/[slug]
 * kept in step with the player-facing "Pools" rebrand. Both URLs
 * render the same SyndicateManageView so old links + new links from
 * the profile page resolve cleanly (Tim 2026-05-22).
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

import { SyndicateManageView } from "../../syndicates/[slug]/SyndicateManageView";
import "../../syndicates/dashboard.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage pool · Tournamental",
};

export default function PoolManagePage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  return (
    <AppShell title="Manage pool">
      <SyndicateManageView slug={params.slug} />
    </AppShell>
  );
}
