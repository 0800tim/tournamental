/**
 * MembersGrid — 12-up (4-up on mobile) avatar grid showing recent
 * joiners. Pure presentational; consumes any `MockMember[]` slice.
 *
 * Each tile shows the avatar, handle, country flag, and a "joined Nd
 * ago" relative time derived deterministically from the member's id.
 */

import { pickAvatar } from "@/lib/mock/avatar";
import type { MockMember } from "@/lib/mock/leaderboard";

import "./syndicate.css";

export interface MembersGridProps {
  readonly members: readonly MockMember[];
  readonly limit?: number;
}

export function MembersGrid({ members, limit = 12 }: MembersGridProps) {
  const rows = members.slice(0, limit);
  return (
    <section className="vt-syn-section">
      <h3 className="vt-syn-section-title">
        Recent members
        <span className="vt-syn-section-title-meta">
          {members.length.toLocaleString()} total
        </span>
      </h3>
      <div className="vt-syn-members-grid">
        {rows.map((m, idx) => (
          <article className="vt-syn-member" key={m.id}>
            <img
              className="vt-syn-member-avatar"
              src={pickAvatar(m.handle)}
              alt=""
              width={48}
              height={48}
              loading="lazy"
            />
            <span className="vt-syn-member-handle">{m.handle}</span>
            <span className="vt-syn-member-meta">
              <span aria-hidden="true">{m.flag}</span>
              <span>{joinedAgo(idx)}</span>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function joinedAgo(idx: number): string {
  // Deterministic, gentle progression: recent joiners first.
  if (idx === 0) return "just now";
  if (idx < 3) return `${idx + 1}h ago`;
  if (idx < 6) return `${idx - 1}d ago`;
  return `${Math.min(14, idx)}d ago`;
}
