"use client";

/**
 * Client view for the per-syndicate manage screen. Fetches the
 * owner-scoped data and renders tier, embed snippet, public-landing
 * link, and tier-aware actions.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { useUser } from "@/lib/auth/useUser";

interface OwnerSyndicate {
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
  readonly size_band: string;
  readonly marketing_consent: boolean;
  readonly owner_handle: string | null;
}

type FetchState =
  | { status: "loading" }
  | { status: "unauth" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "ready"; syndicate: OwnerSyndicate }
  | { status: "error"; message: string };

const HL_CHECKOUT_URL =
  process.env.NEXT_PUBLIC_HL_CHECKOUT_URL ??
  "https://tournamental.com/syndicates#pricing";
const HL_ADMIN_BASE = "https://app.gohighlevel.com/location";

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function tierLabel(tier: OwnerSyndicate["tier"]): string {
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
  return `<tournamental-syndicate slug="${slug}"></tournamental-syndicate>\n<script src="https://embed.tournamental.com/widget.js" async></script>`;
}

export function SyndicateManageView({ slug }: { slug: string }): JSX.Element {
  const auth = useUser();
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user) {
      setState({ status: "unauth" });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/owner`, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (cancelled) return;
        if (r.status === 401) {
          setState({ status: "unauth" });
          return;
        }
        if (r.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (r.status === 404) {
          setState({ status: "not_found" });
          return;
        }
        if (!r.ok) {
          setState({ status: "error", message: `Server returned ${r.status}` });
          return;
        }
        const body = (await r.json()) as { syndicate?: OwnerSyndicate };
        if (!body.syndicate) {
          setState({ status: "error", message: "Empty response" });
          return;
        }
        setState({ status: "ready", syndicate: body.syndicate });
      } catch (e) {
        if (cancelled) return;
        setState({
          status: "error",
          message: e instanceof Error ? e.message : "Network error",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.loading, auth.user?.id, slug]);

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied; user can select manually */
    }
  };

  if (state.status === "loading") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <Link href="/dashboard/syndicates" className="vt-dash-link">
            ← Back to your syndicates
          </Link>
          <p className="vt-dash-eyebrow">Manage syndicate</p>
          <h1 className="vt-dash-title">Loading…</h1>
        </header>
      </main>
    );
  }

  if (state.status === "unauth") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Manage syndicate</p>
          <h1 className="vt-dash-title">Sign in to manage this syndicate.</h1>
          <p className="vt-dash-sub">Only the syndicate&apos;s owner can manage it.</p>
          <div className="vt-dash-cta-row">
            <a href="/?sign-in=1" className="vt-dash-btn vt-dash-btn-primary">
              Sign in
            </a>
            <Link href="/syndicates" className="vt-dash-btn vt-dash-btn-ghost">
              Back to syndicates
            </Link>
          </div>
        </header>
      </main>
    );
  }

  if (state.status === "forbidden") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Manage syndicate</p>
          <h1 className="vt-dash-title">You don&apos;t own this syndicate.</h1>
          <p className="vt-dash-sub">
            Only the owner can see the manage screen. If you joined this syndicate as a member,
            head to the public page instead.
          </p>
          <div className="vt-dash-cta-row">
            <Link href={`/s/${slug}`} className="vt-dash-btn vt-dash-btn-primary">
              View public page →
            </Link>
            <Link href="/dashboard/syndicates" className="vt-dash-btn vt-dash-btn-ghost">
              ← Your syndicates
            </Link>
          </div>
        </header>
      </main>
    );
  }

  if (state.status === "not_found") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Manage syndicate</p>
          <h1 className="vt-dash-title">Syndicate not found.</h1>
          <p className="vt-dash-sub">No syndicate at /s/{slug}.</p>
          <div className="vt-dash-cta-row">
            <Link href="/syndicates/new" className="vt-dash-btn vt-dash-btn-primary">
              Create one
            </Link>
            <Link href="/dashboard/syndicates" className="vt-dash-btn vt-dash-btn-ghost">
              ← Your syndicates
            </Link>
          </div>
        </header>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <Link href="/dashboard/syndicates" className="vt-dash-link">
            ← Back to your syndicates
          </Link>
          <p className="vt-dash-eyebrow">Manage syndicate</p>
          <h1 className="vt-dash-title">Couldn&apos;t load this syndicate.</h1>
          <p className="vt-dash-sub">{state.message}. Refresh and try again.</p>
        </header>
      </main>
    );
  }

  const s = state.syndicate;

  return (
    <main className="vt-dash">
      <header className="vt-dash-hero">
        <Link href="/dashboard/syndicates" className="vt-dash-link">
          ← Back to your syndicates
        </Link>
        <p className="vt-dash-eyebrow">Manage syndicate</p>
        <h1 className="vt-dash-title">{s.name}</h1>
        <p className="vt-dash-sub">
          /s/{s.slug} · {s.member_count}{" "}
          {s.member_count === 1 ? "member" : "members"} · created {formatDate(s.created_at)}
        </p>
        <div className="vt-dash-cta-row">
          <span
            className={`vt-dash-tier vt-dash-tier-${s.tier}`}
            data-tier={s.tier}
          >
            {tierLabel(s.tier)}
          </span>
          {s.tier === "premium" && s.hl_location_id && (
            <a
              href={`${HL_ADMIN_BASE}/${s.hl_location_id}`}
              target="_blank"
              rel="noreferrer"
              className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
            >
              Open in HighLevel →
            </a>
          )}
          <a
            href={`/s/${s.share_guid}`}
            target="_blank"
            rel="noreferrer"
            className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
          >
            View public page →
          </a>
        </div>
      </header>

      {/* Tier callout */}
      {s.tier === "free" && (
        <section className="vt-dash-row" style={{ marginBottom: 16 }}>
          <div className="vt-dash-row-head">
            <div>
              <h2 className="vt-dash-row-name">Upgrade to Premium</h2>
              <p className="vt-dash-row-meta">
                Premium adds a fully-managed CRM, your own SMS/WhatsApp/email, paid entries via
                Stripe, and removes the Tournamental footer. Delivered by Aiva, our CRM partner.
              </p>
            </div>
          </div>
          <div className="vt-dash-row-actions">
            <a
              href={HL_CHECKOUT_URL}
              target="_blank"
              rel="noreferrer"
              className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
            >
              Upgrade to Premium ($97/mo via Aiva) →
            </a>
            <a
              href="https://tournamental.com/partners/aiva"
              target="_blank"
              rel="noreferrer"
              className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
            >
              Learn about Aiva →
            </a>
          </div>
        </section>
      )}

      {s.tier === "premium" && (
        <section className="vt-dash-row" style={{ marginBottom: 16 }}>
          <div className="vt-dash-row-head">
            <div>
              <h2 className="vt-dash-row-name">Premium active</h2>
              <p className="vt-dash-row-meta">
                Aiva provisioned your HighLevel sub-account on{" "}
                {s.hl_premium_since ? formatDate(s.hl_premium_since) : "the activation date"}.
                Manage workflows, send broadcasts, and view subscription state inside HighLevel.
              </p>
            </div>
          </div>
        </section>
      )}

      {s.tier === "past_due" && (
        <section className="vt-dash-row" style={{ marginBottom: 16 }}>
          <div className="vt-dash-row-head">
            <div>
              <h2 className="vt-dash-row-name">Payment overdue</h2>
              <p className="vt-dash-row-meta">
                Your premium subscription payment didn&apos;t go through. Premium features stay
                active for a grace period; resolve the payment to avoid downgrade.
              </p>
            </div>
          </div>
          <div className="vt-dash-row-actions">
            <a
              href={HL_CHECKOUT_URL}
              target="_blank"
              rel="noreferrer"
              className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
            >
              Resolve payment →
            </a>
          </div>
        </section>
      )}

      {/* Embed snippet */}
      <section className="vt-dash-row" style={{ marginBottom: 16 }}>
        <div className="vt-dash-row-head">
          <div>
            <h2 className="vt-dash-row-name">Embed widget</h2>
            <p className="vt-dash-row-meta">
              Drop these two lines anywhere on your site. Works on Squarespace, WordPress,
              Shopify, Webflow, or custom HTML.
            </p>
          </div>
        </div>
        <div className="vt-dash-row-embed">
          <pre className="vt-dash-snippet">
            <code>{embedSnippet(s.slug)}</code>
          </pre>
          <button
            type="button"
            className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
            onClick={() => {
              void copy(embedSnippet(s.slug));
            }}
          >
            {copied ? "Copied!" : "Copy snippet"}
          </button>
        </div>
      </section>

      {/* Useful links */}
      <section className="vt-dash-row" style={{ marginBottom: 16 }}>
        <div className="vt-dash-row-head">
          <div>
            <h2 className="vt-dash-row-name">Useful links</h2>
          </div>
        </div>
        <div className="vt-dash-row-actions">
          <Link href={`/s/${s.share_guid}`} className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm">
            Public page →
          </Link>
          <Link href="/syndicates/playbook" className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm">
            Read the playbook →
          </Link>
          <Link href="/syndicates" className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm">
            All syndicate info →
          </Link>
        </div>
      </section>

      <footer className="vt-dash-foot">
        <p className="vt-dash-sub">
          Need to change a setting that isn&apos;t here yet (name, branding, sponsor block, prize
          copy)? More controls land soon. In the meantime, message us via the contact form on
          the marketing site.
        </p>
      </footer>
    </main>
  );
}
