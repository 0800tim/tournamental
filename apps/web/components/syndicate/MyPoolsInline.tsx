"use client";

/**
 * Compact "pools you're in" list for the top of the /syndicates hero.
 *
 * Reuses the same /api/v1/profile/syndicates endpoint as the profile
 * page's MyPoolsSection, but renders a tight inline list (name, role,
 * a direct View link, plus Manage for owners). Most users are in a
 * single pool, so surfacing it here beats a "My Pools" button.
 *
 * Renders nothing for signed-out visitors, while loading, on error, or
 * when the user is in zero pools, so the marketing hero stays clean for
 * everyone who doesn't already have a pool.
 */

import { useEffect, useState } from "react";

interface MyPool {
  readonly slug: string;
  readonly name: string;
  readonly role: "owner" | "member";
  readonly member_count: number;
}

export function MyPoolsInline(): JSX.Element | null {
  const [pools, setPools] = useState<MyPool[] | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const r = await fetch("/api/v1/profile/syndicates", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: ac.signal,
        });
        if (!r.ok) {
          setPools([]);
          return;
        }
        const body = (await r.json()) as {
          syndicates?: MyPool[];
          is_super_admin?: boolean;
        };
        setPools(body.syndicates ?? []);
        setIsSuperAdmin(!!body.is_super_admin);
      } catch {
        if (!ac.signal.aborted) setPools([]);
      }
    })();
    return () => ac.abort();
  }, []);

  if (!pools || pools.length === 0) return null;

  return (
    <nav className="vt-mpi" aria-label="Pools you're in">
      <p className="vt-mpi-label">
        {pools.length === 1 ? "Your pool" : "Your pools"}
      </p>
      <ul className="vt-mpi-list">
        {pools.map((p) => {
          const canManage = p.role === "owner" || isSuperAdmin;
          return (
            <li key={p.slug} className="vt-mpi-row">
              <div className="vt-mpi-main">
                <a href={`/s/${p.slug}`} className="vt-mpi-name">
                  {p.name}
                </a>
                <span className="vt-mpi-meta">
                  {p.member_count}{" "}
                  {p.member_count === 1 ? "member" : "members"} ·{" "}
                  {p.role === "owner" ? "Owner" : "Member"}
                </span>
              </div>
              <div className="vt-mpi-actions">
                <a
                  href={`/s/${p.slug}`}
                  className="vt-mpi-btn vt-mpi-btn--primary"
                >
                  View
                </a>
                {canManage && (
                  <a
                    href={`/dashboard/pools/${p.slug}`}
                    className="vt-mpi-btn vt-mpi-btn--ghost"
                  >
                    Manage
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <style jsx>{`
        .vt-mpi {
          margin: 0 0 22px;
          padding: 14px 16px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.03);
          max-width: 640px;
        }
        .vt-mpi-label {
          margin: 0 0 10px;
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--vt-gold-400, #dca94b);
          font-weight: 600;
        }
        .vt-mpi-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .vt-mpi-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .vt-mpi-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .vt-mpi-name {
          font-weight: 700;
          font-size: 16px;
          color: var(--vt-fg, #f4f4f5);
          text-decoration: none;
        }
        .vt-mpi-name:hover {
          text-decoration: underline;
        }
        .vt-mpi-meta {
          font-size: 13px;
          color: var(--vt-fg-muted, #9aa6c2);
        }
        .vt-mpi-actions {
          display: flex;
          gap: 8px;
          flex: 0 0 auto;
        }
        .vt-mpi-btn {
          display: inline-flex;
          align-items: center;
          padding: 7px 16px;
          border-radius: 9999px;
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          border: 1px solid transparent;
          white-space: nowrap;
        }
        .vt-mpi-btn--primary {
          background: var(--vt-gold-400, #dca94b);
          color: #15151a;
        }
        .vt-mpi-btn--ghost {
          background: transparent;
          border-color: rgba(255, 255, 255, 0.18);
          color: var(--vt-fg, #f4f4f5);
        }
      `}</style>
    </nav>
  );
}
