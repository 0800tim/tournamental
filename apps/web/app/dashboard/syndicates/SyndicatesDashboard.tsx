"use client";

/**
 * Client component for the syndicate dashboard.
 *
 * Three states:
 *   1. loading   — auth probe is in flight; render a skeleton.
 *   2. unauth    — no session; render the "sign in to manage" CTA.
 *   3. ready     — fetched syndicates; render the list (which may be
 *                  an empty-state CTA to create a first syndicate).
 *
 * The premium-upgrade CTA links out to `NEXT_PUBLIC_HL_CHECKOUT_URL`
 * if configured. That URL is HighLevel's hosted Stripe Checkout for
 * the $97/mo Aiva-managed plan; Tim configures it once in HL and we
 * just open it in a new tab. Per the architecture: the codebase
 * never sees Stripe; HL owns billing.
 */

import { useEffect, useMemo, useState } from "react";

import { useUser } from "@/lib/auth/useUser";

import { HlStatusBanner } from "./HlStatusBanner";

export interface DashboardSyndicate {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly tournament_id: string;
  readonly tier: "free" | "premium" | "past_due";
  readonly member_count: number;
  readonly created_at: number;
  readonly share_guid: string;
  readonly hl_location_id: string | null;
  readonly hl_premium_since: number | null;
  readonly topic: string | null;
}

type ListState =
  | { status: "loading" }
  | { status: "unauth" }
  | { status: "ready"; syndicates: readonly DashboardSyndicate[] }
  | { status: "error"; message: string };

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function tierLabel(tier: DashboardSyndicate["tier"]): string {
  switch (tier) {
    case "premium":
      return "Premium";
    case "past_due":
      return "Premium · payment overdue";
    case "free":
    default:
      return "Free";
  }
}

function embedSnippet(slug: string): string {
  return `<tournamental-syndicate slug="${slug}"></tournamental-syndicate>\n<script src="https://play.tournamental.com/widget.js" async></script>`;
}

const HL_CHECKOUT_URL =
  process.env.NEXT_PUBLIC_HL_CHECKOUT_URL ?? "https://tournamental.com/syndicates#pricing";

export function SyndicatesDashboard(): JSX.Element {
  const auth = useUser();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user) {
      setList({ status: "unauth" });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/v1/syndicates/mine", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!r.ok) {
          if (r.status === 401) {
            if (!cancelled) setList({ status: "unauth" });
            return;
          }
          if (!cancelled) setList({ status: "error", message: `Server returned ${r.status}` });
          return;
        }
        const body = (await r.json()) as { syndicates?: DashboardSyndicate[] };
        if (cancelled) return;
        setList({ status: "ready", syndicates: body.syndicates ?? [] });
      } catch (e) {
        if (cancelled) return;
        setList({
          status: "error",
          message: e instanceof Error ? e.message : "Network error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.loading, auth.user?.id]);

  const handleCopy = async (slug: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(embedSnippet(slug));
      setCopiedSlug(slug);
      window.setTimeout(() => setCopiedSlug((s) => (s === slug ? null : s)), 2000);
    } catch {
      // No clipboard access; the user can still select and copy
      // manually from the inline <pre>.
    }
  };

  const summary = useMemo(() => {
    if (list.status !== "ready") return null;
    const total = list.syndicates.length;
    const premium = list.syndicates.filter((s) => s.tier === "premium").length;
    const members = list.syndicates.reduce((acc, s) => acc + s.member_count, 0);
    return { total, premium, members };
  }, [list]);

  if (list.status === "loading") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Syndicates</p>
          <h1 className="vt-dash-title">Loading your syndicates…</h1>
        </header>
      </main>
    );
  }

  if (list.status === "unauth") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Syndicates</p>
          <h1 className="vt-dash-title">Sign in to manage your syndicates.</h1>
          <p className="vt-dash-sub">
            Syndicates are the branded pools you run on top of Tournamental,
            free or premium. Sign in to see the ones you&apos;ve created.
          </p>
          <div className="vt-dash-cta-row">
            <a href="/?sign-in=1" className="vt-dash-btn vt-dash-btn-primary">
              Sign in
            </a>
            <a href="/syndicates/new" className="vt-dash-btn vt-dash-btn-ghost">
              Or create one now
            </a>
          </div>
        </header>
      </main>
    );
  }

  if (list.status === "error") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Syndicates</p>
          <h1 className="vt-dash-title">Couldn&apos;t load your syndicates.</h1>
          <p className="vt-dash-sub">{list.message}. Refresh and try again.</p>
        </header>
      </main>
    );
  }

  if (list.syndicates.length === 0) {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Syndicates</p>
          <h1 className="vt-dash-title">You haven&apos;t created a syndicate yet.</h1>
          <p className="vt-dash-sub">
            A syndicate is your own branded pool. Drop the embed widget on
            any site, invite your audience, and run a six-week prediction
            game with your own prize on top.
          </p>
          <div className="vt-dash-cta-row">
            <a href="/syndicates/new" className="vt-dash-btn vt-dash-btn-primary">
              Create my first syndicate
            </a>
            <a href="https://tournamental.com/syndicates/playbook" target="_blank" rel="noreferrer" className="vt-dash-btn vt-dash-btn-ghost">
              Read the playbook
            </a>
          </div>
        </header>
      </main>
    );
  }

  return (
    <main className="vt-dash">
      <HlStatusBanner />
      <header className="vt-dash-hero">
        <p className="vt-dash-eyebrow">Syndicates</p>
        <h1 className="vt-dash-title">Your syndicates</h1>
        {summary && (
          <p className="vt-dash-sub">
            {summary.total} {summary.total === 1 ? "syndicate" : "syndicates"} ·{" "}
            {summary.members} {summary.members === 1 ? "member" : "members"} total
            {summary.premium > 0
              ? ` · ${summary.premium} on premium`
              : ""}
          </p>
        )}
        <div className="vt-dash-cta-row">
          <a href="/syndicates/new" className="vt-dash-btn vt-dash-btn-primary">
            + New syndicate
          </a>
          <a href="https://tournamental.com/syndicates/playbook" target="_blank" rel="noreferrer" className="vt-dash-btn vt-dash-btn-ghost">
            Playbook
          </a>
        </div>
      </header>

      <ul className="vt-dash-list">
        {list.syndicates.map((s) => (
          <li key={s.id} className="vt-dash-row">
            <div className="vt-dash-row-head">
              <div>
                <h2 className="vt-dash-row-name">{s.name}</h2>
                <p className="vt-dash-row-meta">
                  /s/{s.slug} · {s.member_count} {s.member_count === 1 ? "member" : "members"} · created {formatDate(s.created_at)}
                </p>
              </div>
              <span
                className={`vt-dash-tier vt-dash-tier-${s.tier}`}
                data-tier={s.tier}
              >
                {tierLabel(s.tier)}
              </span>
            </div>

            <div className="vt-dash-row-embed">
              <p className="vt-dash-row-label">Embed snippet</p>
              <pre className="vt-dash-snippet">
                <code>{embedSnippet(s.slug)}</code>
              </pre>
              <button
                type="button"
                className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
                onClick={() => {
                  void handleCopy(s.slug);
                }}
              >
                {copiedSlug === s.slug ? "Copied!" : "Copy snippet"}
              </button>
            </div>

            <div className="vt-dash-row-actions">
              <a
                href={`/s/${s.share_guid}`}
                target="_blank"
                rel="noreferrer"
                className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
              >
                View public page →
              </a>
              {s.tier === "free" && (
                <a
                  href={HL_CHECKOUT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
                >
                  Upgrade to Premium ($97/mo via Aiva) →
                </a>
              )}
              {s.tier === "premium" && (
                <span className="vt-dash-premium-note">
                  Premium active since{" "}
                  {s.hl_premium_since ? formatDate(s.hl_premium_since) : "recently"}.
                  CRM access via Aiva.
                </span>
              )}
              {s.tier === "past_due" && (
                <a
                  href={HL_CHECKOUT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
                >
                  Resolve payment →
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      <footer className="vt-dash-foot">
        <p className="vt-dash-sub">
          Premium tier is delivered by{" "}
          <a href="https://tournamental.com/partners/aiva" target="_blank" rel="noreferrer" className="vt-dash-link">
            Aiva
          </a>
          , our CRM and messaging partner. Billing, contracts, and CRM
          provisioning happen inside HighLevel; Tournamental never
          handles your subscription or your entry-fee revenue.
        </p>
      </footer>
    </main>
  );
}
