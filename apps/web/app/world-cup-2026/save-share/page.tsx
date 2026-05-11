/**
 * /world-cup-2026/save-share, the LOGGED-IN user's view of their own
 * save-share surface.
 *
 * This is distinct from `/world-cup-2026/share/[bracketId]` (the public
 * per-bracket landing seen by recipients of a share link). This route
 * is the OWNER'S deep-share surface: big card preview, copyable URL,
 * platform buttons, and download/embed affordances.
 *
 * Cache policy: this is per-user content and reads from localStorage on
 * the client, so the server side is effectively a thin shell -
 * `no-store` at the page level is fine (the static-asset payload is
 * cached as usual, and the OG image is cached at /api/og/bracket).
 *
 * Auth: parallel PR #138 will land a `useUser()` hook. Until then we
 * pass `authUserId={undefined}` and the share guid falls back to the
 * bracket's stable `bracketId` (which is a hash of user × tournament
 * per apps/web/lib/bracket/storage.ts). The share URL is therefore
 * stable for the same browser today, and will upgrade to the auth user
 * id transparently when #138 merges.
 */

import type { Metadata } from "next";

import { loadFixtures2026 } from "@vtorn/bracket-engine";

import { ShareSavePage } from "@/components/share/ShareSavePage";
import { AppShell } from "@/components/shell";
import { enrichTournamentTeams, type CanonicalTeamsFile } from "@/lib/bracket/enrich";
import canonicalTeamsRaw from "@/../../data/fifa-wc-2026/teams.json";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Save & share your bracket, Tournamental",
  description:
    "Share your FIFA World Cup 2026 bracket. Copy the link, share to WhatsApp / Telegram / X / Facebook / Email, or download the card image.",
};

export default function SaveSharePageRoute(): JSX.Element {
  const baseTournament = loadFixtures2026();
  const tournament = enrichTournamentTeams(
    baseTournament,
    canonicalTeamsRaw as CanonicalTeamsFile,
  );

  return (
    <AppShell title="Save & share">
      <ShareSavePage tournament={tournament} />
    </AppShell>
  );
}
