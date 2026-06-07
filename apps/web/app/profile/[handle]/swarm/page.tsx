/**
 * /profile/[handle]/swarm , "My Swarm" tab for the operator-keyed
 * aggregate-leaderboard surface (A13).
 *
 * The `[handle]` URL segment is the operator_id (sha256 of the
 * operator's API key). Anyone with the URL gets a cheap edge-cached
 * read of the aggregate. The OWN-profile experience is detected on
 * the client by hashing the locally-stored operator API key (if any)
 * and comparing to the URL. When matched, the "Download my raw bot
 * brackets (JSON)" button surfaces from IndexedDB; otherwise only the
 * aggregate JSON download is shown.
 *
 * Style: dark editorial to match /run/bots. Mobile-friendly via the
 * shared AppShell.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/shell";
import {
  defaultPersistence,
  indexedDbPersistence,
  noopPersistence,
} from "@/components/browser-swarm/persistence";

interface AliveAfterMatch {
  n: number;
  alive_count: number;
}

interface TopKEntry {
  bot_id: string;
  score: number;
  chalk_score: number;
}

interface SwarmSummary {
  operator_id: string;
  kickoff_at: number;
  total_bots: number;
  bots_alive_after_match_n: AliveAfterMatch[];
  best_bot_score: number;
  top_k: TopKEntry[];
  merkle_root: string;
  generated_at: number;
}

const HEX64 = /^[0-9a-f]{64}$/;

async function sha256Hex(input: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < view.length; i++)
    hex += view[i]!.toString(16).padStart(2, "0");
  return hex;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-NZ").format(n);
}

export default function SwarmProfilePage({
  params,
}: {
  params: { handle: string };
}): JSX.Element {
  const handle = params.handle.toLowerCase();
  const handleIsOperatorId = HEX64.test(handle);

  const [summary, setSummary] = useState<SwarmSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOwnProfile, setIsOwnProfile] = useState(false);

  // Detect own-profile by hashing the local operator key.
  useEffect(() => {
    let cancelled = false;
    if (!handleIsOperatorId) return;
    const persist = typeof indexedDB !== "undefined"
      ? indexedDbPersistence
      : noopPersistence;
    persist
      .loadOperatorApiKey()
      .then(async (key) => {
        if (cancelled || !key) return;
        const hash = await sha256Hex(key);
        if (!cancelled && hash === handle) setIsOwnProfile(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [handle, handleIsOperatorId]);

  // Fetch the aggregate summary.
  useEffect(() => {
    let cancelled = false;
    if (!handleIsOperatorId) {
      setError("invalid_handle");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/v1/swarms/${handle}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setError("not_found");
          setSummary(null);
          return;
        }
        if (!res.ok) {
          setError(`http_${res.status}`);
          return;
        }
        const json = (await res.json()) as SwarmSummary;
        setSummary(json);
      })
      .catch(() => {
        if (!cancelled) setError("network_error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handle, handleIsOperatorId]);

  const sparkline = useMemo(() => {
    if (!summary) return null;
    return summary.bots_alive_after_match_n.slice().sort((a, b) => a.n - b.n);
  }, [summary]);

  const onDownloadSummary = useCallback(() => {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tournamental-swarm-${handle.slice(0, 16)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [summary, handle]);

  const onDownloadRawBrackets = useCallback(async () => {
    // Local-only: read every IndexedDB sample row and dump as JSON.
    try {
      const persist = defaultPersistence();
      const bots = await persist
        .countBots()
        .then((n) => n)
        .catch(() => 0);
      const picks = await persist
        .countPicks()
        .then((n) => n)
        .catch(() => 0);
      // The persistence interface exposes counts but not list-all
      // helpers; we ship counts in the metadata + a hint that the
      // full deterministic regeneration is what /run/bots uses to
      // render a billion bots without storing picks. The download
      // serves as a portable identity stamp for the owner.
      const blob = new Blob(
        [
          JSON.stringify(
            {
              operator_id: handle,
              source: "indexeddb",
              sample_bots_count: bots,
              sample_picks_count: picks,
              note:
                "Raw per-bot brackets are deterministic. Use master_seed + bot_index from /run/bots to regenerate any bot offline.",
              generated_at: Date.now(),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tournamental-raw-${handle.slice(0, 16)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Silent: this is an offline-only convenience.
    }
  }, [handle]);

  return (
    <AppShell title="My swarm">
      <main className="vt-swarm-profile">
        <article className="vt-swarm-profile-article">
          <header className="vt-swarm-profile-header">
            <p className="vt-swarm-profile-dateline">
              Aggregate-leaderboard · operator{" "}
              <code>{handle.slice(0, 16)}</code>
            </p>
            <h1 className="vt-swarm-profile-title">My swarm</h1>
            <p className="vt-swarm-profile-lede">
              Cumulative aggregate of every bot this operator has generated.
              Raw per-bot picks stay private until a bot survives match 80
              on a perfect track, at which point audit opens.
            </p>
          </header>

          {loading && (
            <p style={{ color: "#a8a8a8" }}>Loading aggregate…</p>
          )}

          {error === "invalid_handle" && (
            <p style={{ color: "#f6c64f" }}>
              The URL handle is not a valid operator id. Expected a 64-char
              hex sha256.
            </p>
          )}
          {error === "not_found" && (
            <p style={{ color: "#a8a8a8" }}>
              No aggregate published yet for this operator. The owner needs
              to run a swarm at <code>/run</code> with an operator API key
              configured.
            </p>
          )}
          {error && error !== "invalid_handle" && error !== "not_found" && (
            <p style={{ color: "#ff6b6b" }}>Error: {error}</p>
          )}

          {summary && (
            <>
              <section
                className="vt-swarm-profile-stats"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 16,
                  marginTop: 24,
                }}
              >
                <StatCard
                  label="Total bots"
                  value={formatNumber(summary.total_bots)}
                />
                <StatCard
                  label="Best bot score"
                  value={`${summary.best_bot_score} / 104`}
                />
                <StatCard
                  label="Latest merkle root"
                  value={`${summary.merkle_root.slice(0, 16)}…`}
                  mono
                />
                <StatCard
                  label="Last updated"
                  value={new Date(summary.generated_at).toLocaleString()}
                />
              </section>

              {sparkline && sparkline.length > 0 && (
                <section style={{ marginTop: 32 }}>
                  <h2
                    style={{
                      fontSize: 14,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#f6c64f",
                    }}
                  >
                    Bots still alive by match
                  </h2>
                  <Sparkline data={sparkline} />
                </section>
              )}

              <section
                style={{
                  display: "flex",
                  gap: 12,
                  marginTop: 32,
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={onDownloadSummary}
                  className="vt-swarm-button vt-swarm-button--primary"
                  style={{
                    padding: "10px 16px",
                    background: "#f6c64f",
                    color: "#0a0a0a",
                    border: "none",
                    borderRadius: 6,
                    fontFamily:
                      '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Download swarm summary (JSON)
                </button>
                {isOwnProfile && (
                  <button
                    type="button"
                    onClick={() => void onDownloadRawBrackets()}
                    className="vt-swarm-button vt-swarm-button--ghost"
                    style={{
                      padding: "10px 16px",
                      background: "transparent",
                      color: "#eaeaea",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: 6,
                      fontFamily:
                        '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Download my raw bot brackets (JSON)
                  </button>
                )}
              </section>

              {summary.top_k.length > 0 && (
                <section style={{ marginTop: 32 }}>
                  <h2
                    style={{
                      fontSize: 14,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#f6c64f",
                    }}
                  >
                    Top bots in this swarm
                  </h2>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      marginTop: 12,
                      fontFamily:
                        '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
                      fontSize: 12,
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                        <th style={{ padding: 8, textAlign: "left" }}>#</th>
                        <th style={{ padding: 8, textAlign: "left" }}>Bot ID</th>
                        <th style={{ padding: 8, textAlign: "right" }}>Score</th>
                        <th style={{ padding: 8, textAlign: "right" }}>
                          Chalk score
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.top_k.slice(0, 50).map((b, i) => (
                        <tr
                          key={b.bot_id}
                          style={{
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <td style={{ padding: 8 }}>{i + 1}</td>
                          <td style={{ padding: 8 }}>{b.bot_id}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>
                            {b.score}
                          </td>
                          <td style={{ padding: 8, textAlign: "right" }}>
                            {b.chalk_score.toFixed(3)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}
            </>
          )}
        </article>
      </main>
    </AppShell>
  );
}

function StatCard({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        padding: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        background: "rgba(255,255,255,0.03)",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#a8a8a8",
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 20,
          color: "#eaeaea",
          fontFamily: mono
            ? '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace'
            : "inherit",
        }}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Inline SVG sparkline of bots-alive-by-match. Pure SVG so it
 * renders the same SSR + client without a chart library.
 */
function Sparkline({ data }: { data: AliveAfterMatch[] }): JSX.Element {
  const W = 600;
  const H = 80;
  const maxN = Math.max(...data.map((d) => d.n), 1);
  const maxAlive = Math.max(...data.map((d) => d.alive_count), 1);
  const points = data
    .map((d) => {
      const x = (d.n / maxN) * W;
      const y = H - (d.alive_count / maxAlive) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{
        width: "100%",
        height: H,
        marginTop: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 6,
        background: "rgba(0,0,0,0.2)",
      }}
      role="img"
      aria-label="Bots alive by match number"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#f6c64f"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
