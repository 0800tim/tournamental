/**
 * /dashboard/syndicates/[slug]/connect — premium-upgrade wizard.
 *
 * Walks the syndicate owner through the upgrade path:
 *   Step 1 — Open Stripe Checkout (hosted by HighLevel)
 *   Step 2 — Wait while HL provisions the sub-account (~1-2 min)
 *   Step 3 — Check email for the HL login
 *
 * The actual upgrade lifecycle runs entirely inside HighLevel
 * workflows (per the architectural rule that all billing lives
 * outside the codebase). This page just guides the user and
 * polls the owner endpoint to detect the tier flip when the HL
 * webhook fires.
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

import { ConnectWizard } from "./ConnectWizard";
import "../../dashboard.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Upgrade to Premium · Tournamental",
};

export default async function ConnectPage(
  props: {
    params: Promise<{ slug: string }>;
  }
): Promise<JSX.Element> {
  const params = await props.params;
  return (
    <AppShell title="Upgrade to Premium">
      <ConnectWizard slug={params.slug} />
    </AppShell>
  );
}
