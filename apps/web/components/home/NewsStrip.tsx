/**
 * NewsStrip — horizontal news scroller pinned to the home feed.
 *
 * - Mobile: horizontal scroll; cards snap.
 * - Desktop: 4-column grid.
 *
 * Data: fetched client-side from `/api/news?limit=8` (the Next route
 * handler proxies to the news-aggregator service). We render a
 * skeleton while fetching, then swap in real cards. On upstream
 * failure we render a single "news temporarily unavailable" card so
 * the layout doesn't collapse.
 *
 * This component does NOT render on /world-cup-2026 — it's home-only.
 * The home page composes it directly; nothing here gates the route.
 */
"use client";

import { useEffect, useState } from "react";

import "./news-strip.css";

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl?: string | null;
  tags?: readonly string[];
}

interface NewsResponse {
  items: NewsItem[];
  total?: number;
  error?: string;
}

const PLACEHOLDER_COUNT = 4;

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(diff)) return "";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function NewsStrip() {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/news?limit=8&lang=en", {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    })
      .then((r) => r.json() as Promise<NewsResponse>)
      .then((j) => {
        if (j.error) setError(j.error);
        setItems(j.items ?? []);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "fetch_failed");
        setItems([]);
      });
    return () => ac.abort();
  }, []);

  return (
    <section className="vt-newsstrip" aria-labelledby="vt-newsstrip-heading">
      <header className="vt-newsstrip-head">
        <h2 className="vt-section-title" id="vt-newsstrip-heading">
          Latest news
        </h2>
      </header>
      <div className="vt-newsstrip-track" role="list">
        {items === null
          ? Array.from({ length: PLACEHOLDER_COUNT }).map((_, i) => (
              <div className="vt-newsstrip-card vt-newsstrip-skeleton" key={i} role="listitem" aria-hidden="true">
                <div className="vt-newsstrip-card-img" />
                <div className="vt-newsstrip-card-body">
                  <div className="vt-newsstrip-skeleton-line" style={{ width: "85%" }} />
                  <div className="vt-newsstrip-skeleton-line" style={{ width: "60%" }} />
                </div>
              </div>
            ))
          : items.length === 0
          ? (
              <div className="vt-newsstrip-empty" role="listitem">
                <p>{error ? `News is taking a breather (${error}).` : "Nothing fresh yet — check back soon."}</p>
              </div>
            )
          : items.map((it) => (
              <a
                key={it.id}
                href={it.url}
                target="_blank"
                rel="noopener nofollow"
                className="vt-newsstrip-card"
                role="listitem"
                data-source={it.source}
              >
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="vt-newsstrip-card-img"
                    src={it.imageUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="vt-newsstrip-card-img vt-newsstrip-card-placeholder" aria-hidden="true" />
                )}
                <span className="vt-newsstrip-card-source">{it.source}</span>
                <div className="vt-newsstrip-card-body">
                  <h3 className="vt-newsstrip-card-title">{it.title}</h3>
                  <span className="vt-newsstrip-card-meta">{timeAgo(it.publishedAt)}</span>
                </div>
              </a>
            ))}
      </div>
    </section>
  );
}
