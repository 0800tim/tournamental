/**
 * /pools — the public pool directory. Lists every public syndicate
 * (is_public = 1) with a search box; tap through to a pool's landing page
 * to join. Server-renders the initial list (newest first); the client
 * search island re-queries /api/v1/syndicates/public as you type.
 *
 * (Replaces the old stub that 301'd to /syndicates. The /syndicates page
 * remains the marketing/pricing surface, linked from here as "How pools
 * work".)
 */

import type { Metadata } from "next";

import { getPersistence } from "@/lib/syndicate/persistence";
import { toPublicPoolDto } from "@/lib/syndicate/public-directory";

import { PoolDirectory } from "./PoolDirectory";
import "./pools.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Public pools · Tournamental",
  description:
    "Browse public prediction pools and join one in a tap. Free to enter, run by hosts and creators for the FIFA World Cup 2026.",
};

export default function PoolsPage() {
  const pools = getPersistence()
    .listPublic({ limit: 60 })
    .map(toPublicPoolDto);
  return <PoolDirectory initialPools={pools} />;
}
