"use client";

/* eslint-disable react/no-unescaped-entities */
/**
 * Client view for the per-syndicate manage screen. Fetches the
 * owner-scoped data and renders tier, embed snippet, public-landing
 * link, tier-aware actions, and the branding editor form (name,
 * brand colours, logo, hero, sponsor block, prize copy).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useUser } from "@/lib/auth/useUser";

import { HlStatusBanner } from "../HlStatusBanner";

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
  readonly branding_primary_colour: string | null;
  readonly branding_accent_colour: string | null;
  readonly branding_logo_url: string | null;
  readonly branding_hero_url: string | null;
  readonly sponsor_name: string | null;
  readonly sponsor_url: string | null;
  readonly sponsor_logo_url: string | null;
  readonly prize_text: string | null;
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
      <HlStatusBanner />
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
            <Link
              href={`/dashboard/syndicates/${s.slug}/connect`}
              className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
            >
              Upgrade to Premium ($97/mo via Aiva) →
            </Link>
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

      {/* Branding editor */}
      <BrandingEditor
        slug={s.slug}
        initial={s}
        onSaved={(updated) =>
          setState({ status: "ready", syndicate: { ...s, ...updated } })
        }
      />

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
          Premium tier is delivered by{" "}
          <a
            href="https://tournamental.com/partners/aiva"
            target="_blank"
            rel="noreferrer"
            className="vt-dash-link"
          >
            Aiva
          </a>
          , our CRM and messaging partner. Billing and CRM provisioning happen inside
          HighLevel; Tournamental never handles your subscription or entry-fee revenue.
        </p>
      </footer>
    </main>
  );
}

// --- Branding editor -------------------------------------------------------

interface BrandingEditorProps {
  readonly slug: string;
  readonly initial: OwnerSyndicate;
  readonly onSaved: (patch: Partial<OwnerSyndicate>) => void;
}

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

const COLOUR_PRESETS: ReadonlyArray<{ label: string; primary: string; accent: string }> = [
  { label: "Tournamental", primary: "#fbbf24", accent: "#21a34a" },
  { label: "Ocean", primary: "#3c8bcf", accent: "#22d3ee" },
  { label: "Forest", primary: "#21a34a", accent: "#fbbf24" },
  { label: "Sunset", primary: "#ff8a3d", accent: "#fbbf24" },
  { label: "Rose", primary: "#f43f5e", accent: "#fbbf24" },
];

function BrandingEditor({ slug, initial, onSaved }: BrandingEditorProps): JSX.Element {
  const [name, setName] = useState(initial.name);
  const [primary, setPrimary] = useState(initial.branding_primary_colour ?? "#fbbf24");
  const [accent, setAccent] = useState(initial.branding_accent_colour ?? "#21a34a");
  const [logoUrl, setLogoUrl] = useState(initial.branding_logo_url ?? "");
  const [heroUrl, setHeroUrl] = useState(initial.branding_hero_url ?? "");
  const [sponsorName, setSponsorName] = useState(initial.sponsor_name ?? "");
  const [sponsorUrl, setSponsorUrl] = useState(initial.sponsor_url ?? "");
  const [sponsorLogoUrl, setSponsorLogoUrl] = useState(initial.sponsor_logo_url ?? "");
  const [prizeText, setPrizeText] = useState(initial.prize_text ?? "");
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const dirty = useMemo(() => {
    return (
      name !== initial.name ||
      primary !== (initial.branding_primary_colour ?? "#fbbf24") ||
      accent !== (initial.branding_accent_colour ?? "#21a34a") ||
      logoUrl !== (initial.branding_logo_url ?? "") ||
      heroUrl !== (initial.branding_hero_url ?? "") ||
      sponsorName !== (initial.sponsor_name ?? "") ||
      sponsorUrl !== (initial.sponsor_url ?? "") ||
      sponsorLogoUrl !== (initial.sponsor_logo_url ?? "") ||
      prizeText !== (initial.prize_text ?? "")
    );
  }, [name, primary, accent, logoUrl, heroUrl, sponsorName, sponsorUrl, sponsorLogoUrl, prizeText, initial]);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!dirty) return;
    setSave({ status: "saving" });

    const trimmedOrNull = (v: string): string | null => {
      const t = v.trim();
      return t.length === 0 ? null : t;
    };

    const body: Record<string, unknown> = {};
    if (name.trim() !== initial.name) body.name = name.trim();
    if (primary !== (initial.branding_primary_colour ?? "#fbbf24"))
      body.branding_primary_colour = primary;
    if (accent !== (initial.branding_accent_colour ?? "#21a34a"))
      body.branding_accent_colour = accent;
    if (logoUrl !== (initial.branding_logo_url ?? ""))
      body.branding_logo_url = trimmedOrNull(logoUrl);
    if (heroUrl !== (initial.branding_hero_url ?? ""))
      body.branding_hero_url = trimmedOrNull(heroUrl);
    if (sponsorName !== (initial.sponsor_name ?? ""))
      body.sponsor_name = trimmedOrNull(sponsorName);
    if (sponsorUrl !== (initial.sponsor_url ?? ""))
      body.sponsor_url = trimmedOrNull(sponsorUrl);
    if (sponsorLogoUrl !== (initial.sponsor_logo_url ?? ""))
      body.sponsor_logo_url = trimmedOrNull(sponsorLogoUrl);
    if (prizeText !== (initial.prize_text ?? ""))
      body.prize_text = trimmedOrNull(prizeText);

    try {
      const r = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/owner`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errBody = (await r.json().catch(() => ({}))) as { error?: string };
        setSave({
          status: "error",
          message: errBody.error ?? `Server returned ${r.status}`,
        });
        return;
      }
      const ok = (await r.json()) as { syndicate?: OwnerSyndicate };
      if (ok.syndicate) {
        onSaved({
          name: ok.syndicate.name,
          branding_primary_colour: ok.syndicate.branding_primary_colour,
          branding_accent_colour: ok.syndicate.branding_accent_colour,
          branding_logo_url: ok.syndicate.branding_logo_url,
          branding_hero_url: ok.syndicate.branding_hero_url,
          sponsor_name: ok.syndicate.sponsor_name,
          sponsor_url: ok.syndicate.sponsor_url,
          sponsor_logo_url: ok.syndicate.sponsor_logo_url,
          prize_text: ok.syndicate.prize_text,
        });
      }
      setSave({ status: "saved" });
      window.setTimeout(() => setSave({ status: "idle" }), 2500);
    } catch (err) {
      setSave({
        status: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  return (
    <section className="vt-dash-row vt-dash-row-form" style={{ marginBottom: 16 }}>
      <div className="vt-dash-row-head">
        <div>
          <h2 className="vt-dash-row-name">Branding</h2>
          <p className="vt-dash-row-meta">
            Customise how your syndicate appears in the embed widget and on its public landing
            page. All fields optional; we fall back to Tournamental defaults if you leave them
            blank.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="vt-brand-form">
        <div className="vt-brand-grid">
          <label className="vt-brand-field">
            <span className="vt-brand-label">Display name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              className="vt-brand-input"
            />
          </label>

          <label className="vt-brand-field">
            <span className="vt-brand-label">Prize copy</span>
            <input
              type="text"
              value={prizeText}
              onChange={(e) => setPrizeText(e.target.value)}
              maxLength={280}
              placeholder='e.g. "Win a $250 store voucher"'
              className="vt-brand-input"
            />
          </label>
        </div>

        <div className="vt-brand-presets">
          <span className="vt-brand-label">Colour preset</span>
          <div className="vt-brand-preset-row">
            {COLOUR_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setPrimary(p.primary);
                  setAccent(p.accent);
                }}
                className="vt-brand-preset"
                style={{
                  background: `linear-gradient(135deg, ${p.primary} 0%, ${p.accent} 100%)`,
                }}
                aria-label={`Apply ${p.label} colour preset`}
                title={p.label}
              />
            ))}
          </div>
        </div>

        <div className="vt-brand-grid">
          <label className="vt-brand-field">
            <span className="vt-brand-label">Primary colour</span>
            <div className="vt-brand-colour-row">
              <input
                type="color"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="vt-brand-colour-swatch"
              />
              <input
                type="text"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
                className="vt-brand-input"
                pattern="^#[0-9a-fA-F]{6}$"
              />
            </div>
          </label>

          <label className="vt-brand-field">
            <span className="vt-brand-label">Accent colour</span>
            <div className="vt-brand-colour-row">
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="vt-brand-colour-swatch"
              />
              <input
                type="text"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="vt-brand-input"
                pattern="^#[0-9a-fA-F]{6}$"
              />
            </div>
          </label>
        </div>

        <div className="vt-brand-grid">
          <label className="vt-brand-field">
            <span className="vt-brand-label">Logo URL (square, 256px+)</span>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://yourbrand.com/logo.png"
              className="vt-brand-input"
            />
          </label>

          <label className="vt-brand-field">
            <span className="vt-brand-label">Hero image URL (wide, 1200px+)</span>
            <input
              type="url"
              value={heroUrl}
              onChange={(e) => setHeroUrl(e.target.value)}
              placeholder="https://yourbrand.com/hero.jpg"
              className="vt-brand-input"
            />
          </label>
        </div>

        <details className="vt-brand-sponsor-details">
          <summary className="vt-brand-summary">Sponsor block (optional)</summary>
          <div className="vt-brand-grid">
            <label className="vt-brand-field">
              <span className="vt-brand-label">Sponsor name</span>
              <input
                type="text"
                value={sponsorName}
                onChange={(e) => setSponsorName(e.target.value)}
                maxLength={120}
                placeholder='e.g. "George FM"'
                className="vt-brand-input"
              />
            </label>
            <label className="vt-brand-field">
              <span className="vt-brand-label">Sponsor website</span>
              <input
                type="url"
                value={sponsorUrl}
                onChange={(e) => setSponsorUrl(e.target.value)}
                placeholder="https://sponsor.com"
                className="vt-brand-input"
              />
            </label>
            <label className="vt-brand-field" style={{ gridColumn: "1 / -1" }}>
              <span className="vt-brand-label">Sponsor logo URL</span>
              <input
                type="url"
                value={sponsorLogoUrl}
                onChange={(e) => setSponsorLogoUrl(e.target.value)}
                placeholder="https://sponsor.com/logo.png"
                className="vt-brand-input"
              />
            </label>
          </div>
        </details>

        <div className="vt-brand-actions">
          <button
            type="submit"
            disabled={!dirty || save.status === "saving"}
            className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
          >
            {save.status === "saving" ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          {save.status === "saved" && (
            <span className="vt-brand-status vt-brand-status-ok">✓ Saved</span>
          )}
          {save.status === "error" && (
            <span className="vt-brand-status vt-brand-status-err">
              {save.message}
            </span>
          )}
          <a
            href={`/embed/preview?slug=${encodeURIComponent(slug)}`}
            target="_blank"
            rel="noreferrer"
            className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
          >
            Preview widget →
          </a>
        </div>
      </form>
    </section>
  );
}
