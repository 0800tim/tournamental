/**
 * /dashboard/pools — alias for /dashboard/syndicates kept in step
 * with the player-facing "Pools" rebrand. Both URLs render the same
 * client component so external links + bookmarks keep working under
 * either path (Tim 2026-05-22).
 */

import type { Metadata } from "next";

import { AppShell } from "@/components/shell";

import { SyndicatesDashboard } from "../syndicates/SyndicatesDashboard";
import "../syndicates/dashboard.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your pools · Tournamental",
  description:
    "Manage the prediction pools you've created on Tournamental. View members, leaderboards, embed snippets, and upgrade to premium.",
};

export default function PoolsDashboardPage(): JSX.Element {
  return (
    <AppShell title="Your pools">
      <SyndicatesDashboard />
    </AppShell>
  );
}
