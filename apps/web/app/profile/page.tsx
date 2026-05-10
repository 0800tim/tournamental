/**
 * /profile — placeholder profile screen.
 * Wired to the bottom nav. Real auth + identity (per docs/20 and
 * docs/32) lands in a follow-up PR.
 */

import Link from "next/link";

import { AppShell } from "@/components/shell";
import { PillChip } from "@/components/ui";

export const metadata = {
  title: "Profile - VTourn",
};

export default function ProfilePage() {
  return (
    <AppShell title="Profile" avatarInitials="V">
      <div className="vt-page-content">
        <section className="vt-section">
          <h2 className="vt-section-title">Sign in</h2>
          <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
            Sign in via Telegram to follow your bracket and pick history.
            Auth lands in the next sprint.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <PillChip tone="accent">Telegram</PillChip>
            <PillChip tone="warm">Email</PillChip>
            <PillChip tone="pitch">Wallet</PillChip>
          </div>
        </section>
        <section className="vt-section">
          <h2 className="vt-section-title">My picks</h2>
          <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
            Your saved picks will appear here once you build a bracket.
          </p>
          <Link
            href="/world-cup-2026"
            style={{
              alignSelf: "flex-start",
              padding: "10px 16px",
              borderRadius: 999,
              background: "var(--vt-accent)",
              color: "var(--vt-accent-on)",
              fontWeight: 700,
              textDecoration: "none",
              fontSize: 14,
            }}
          >
            Build my bracket
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
