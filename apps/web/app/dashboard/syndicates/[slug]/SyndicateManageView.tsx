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
import { BrandingImageUploader } from "@/components/syndicate/BrandingImageUploader";

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
  readonly entry_fee_cents: number | null;
  readonly entry_fee_currency: string | null;
  readonly prize_split_json: string | null;
  readonly bonus_prize_text: string | null;
  readonly join_fee_terms_text: string | null;
  readonly is_public: boolean;
  readonly requires_approval: boolean;
}

interface PendingRequest {
  user_id: string;
  handle?: string | null;
  display_name?: string | null;
  joined_at: number;
}

type FetchState =
  | { status: "loading" }
  | { status: "unauth" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | {
      status: "ready";
      syndicate: OwnerSyndicate;
      pending_requests: PendingRequest[];
    }
  | { status: "error"; message: string };

const HL_CHECKOUT_URL =
  process.env.NEXT_PUBLIC_HL_CHECKOUT_URL ??
  "https://tournamental.com/syndicates#pricing";
const HL_ADMIN_BASE = "https://app.gohighlevel.com/location";

function formatDate(epochMs: number): string {
  const d = new Date(epochMs);
  if (Number.isNaN(d.getTime())) return "-";
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
  return `<tournamental-syndicate slug="${slug}"></tournamental-syndicate>\n<script src="https://play.tournamental.com/widget.js" async></script>`;
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
        const body = (await r.json()) as {
          syndicate?: OwnerSyndicate;
          pending_requests?: PendingRequest[];
        };
        if (!body.syndicate) {
          setState({ status: "error", message: "Empty response" });
          return;
        }
        setState({
          status: "ready",
          syndicate: body.syndicate,
          pending_requests: body.pending_requests ?? [],
        });
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
  const pendingRequests = state.pending_requests;

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
            href={`/s/${s.slug}`}
            target="_blank"
            rel="noreferrer"
            className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
          >
            View public page →
          </a>
        </div>
      </header>

      {/* Approve / deny banner from the email-link redirect. The
        * approve/deny GET routes redirect back here with a
        * ?request=<status> param so the owner sees confirmation of
        * the action they took (Tim 2026-05-22). */}
      <RequestBanner />

      {/* Pending join requests. Only renders when the pool has
        * `requires_approval=1` AND there are pending rows. Owners can
        * approve / deny inline; rows fade out optimistically. */}
      <PendingRequestsPanel
        slug={s.slug}
        initialRequests={pendingRequests}
      />

      {/* Tier callout */}
      {s.tier === "free" && (
        <section className="vt-dash-row" style={{ marginBottom: 16 }}>
          <div className="vt-dash-row-head">
            <div>
              <h2 className="vt-dash-row-name">Upgrade to Premium</h2>
              <p className="vt-dash-row-meta">
                Premium adds a fully-managed CRM, your own SMS/WhatsApp/email, paid entries via
                Stripe, and removes the Tournamental footer. Delivered by Growth Spurt, our CRM partner.
              </p>
            </div>
          </div>
          <div className="vt-dash-row-actions">
            <Link
              href={`/dashboard/syndicates/${s.slug}/connect`}
              className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
            >
              Upgrade to Premium ($97/mo via Growth Spurt) →
            </Link>
            <a
              href="https://tournamental.com/partners/growth-spurt"
              target="_blank"
              rel="noreferrer"
              className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
            >
              Learn about Growth Spurt →
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
                Growth Spurt provisioned your HighLevel sub-account on{" "}
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

      {/* Visibility + access control */}
      <VisibilityEditor
        slug={s.slug}
        initial={s}
        onSaved={(updated) =>
          setState({
            status: "ready",
            syndicate: { ...s, ...updated },
            pending_requests: pendingRequests,
          })
        }
      />

      {/* Prize pool editor (above branding so owners find it before
       * scrolling past logo/hero uploads). Tim 2026-05-24: the prize
       * editor was buried below branding which made setting fees /
       * splits / bonuses harder to discover than it should be. */}
      <PrizePoolEditor
        slug={s.slug}
        initial={s}
        onSaved={(updated) =>
          setState({
            status: "ready",
            syndicate: { ...s, ...updated },
            pending_requests: pendingRequests,
          })
        }
      />

      {/* Branding editor */}
      <BrandingEditor
        slug={s.slug}
        initial={s}
        onSaved={(updated) =>
          setState({
            status: "ready",
            syndicate: { ...s, ...updated },
            pending_requests: pendingRequests,
          })
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
          <Link href={`/s/${s.slug}`} className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm">
            Public page →
          </Link>
          <Link href="/pools/playbook" className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm">
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
            href="https://tournamental.com/partners/growth-spurt"
            target="_blank"
            rel="noreferrer"
            className="vt-dash-link"
          >
            Growth Spurt
          </a>
          , our CRM and messaging partner. Billing and CRM provisioning happen inside
          HighLevel; Tournamental never handles your subscription or entry-fee revenue.
        </p>
      </footer>
    </main>
  );
}

// --- Branding editor -------------------------------------------------------

// ---------------------------------------------------------------------------
// VisibilityEditor - public-vs-private + approval toggle. Mirrors the
// "Visibility" panel from the create form so owners can flip the same
// flags later. Tim 2026-05-22.
// ---------------------------------------------------------------------------

interface VisibilityEditorProps {
  readonly slug: string;
  readonly initial: OwnerSyndicate;
  readonly onSaved: (patch: Partial<OwnerSyndicate>) => void;
}

function VisibilityEditor({ slug, initial, onSaved }: VisibilityEditorProps): JSX.Element {
  const [isPublic, setIsPublic] = useState<boolean>(initial.is_public);
  const [requiresApproval, setRequiresApproval] = useState<boolean>(initial.requires_approval);
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const dirty =
    isPublic !== initial.is_public || requiresApproval !== initial.requires_approval;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!dirty) return;
    setSave({ status: "saving" });
    // Persist the invariant client-side too -- public pools never
    // require approval; the server enforces this regardless.
    const body = {
      is_public: isPublic,
      requires_approval: isPublic ? false : requiresApproval,
    };
    try {
      const r = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/owner`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const errBody = (await r.json().catch(() => ({}))) as { error?: string };
        setSave({ status: "error", message: errBody.error ?? `Server returned ${r.status}` });
        return;
      }
      const ok = (await r.json()) as { syndicate?: OwnerSyndicate };
      if (ok.syndicate) {
        onSaved({
          is_public: ok.syndicate.is_public,
          requires_approval: ok.syndicate.requires_approval,
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
          <h2 className="vt-dash-row-name">Visibility &amp; access</h2>
          <p className="vt-dash-row-meta">
            Public pools appear in the directory and anyone can join in one tap.
            Private pools accept only people you approve.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="vt-brand-form">
        <label className="vt-brand-field" style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            style={{ marginTop: 4 }}
          />
          <span>
            <strong style={{ display: "block", fontWeight: 600 }}>Public pool</strong>
            <span style={{ color: "var(--vt-fg-muted, #94a3b8)", fontSize: 13, lineHeight: 1.4 }}>
              Listed in the pool directory. Anyone with the link or a directory hit can join
              immediately, no approval needed.
            </span>
          </span>
        </label>

        <label
          className="vt-brand-field"
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            opacity: isPublic ? 0.45 : 1,
            cursor: isPublic ? "not-allowed" : "default",
          }}
        >
          <input
            type="checkbox"
            checked={!isPublic && requiresApproval}
            disabled={isPublic}
            onChange={(e) => setRequiresApproval(e.target.checked)}
            style={{ marginTop: 4 }}
          />
          <span>
            <strong style={{ display: "block", fontWeight: 600 }}>Requires approval</strong>
            <span style={{ color: "var(--vt-fg-muted, #94a3b8)", fontSize: 13, lineHeight: 1.4 }}>
              {isPublic
                ? "Disabled for public pools - anyone can join."
                : "Join requests queue here for you to approve or deny. Best for office sweepstakes and closed family pools."}
            </span>
          </span>
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
          <button
            type="submit"
            disabled={!dirty || save.status === "saving"}
            className="vt-dash-action vt-dash-action-primary"
          >
            {save.status === "saving" ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
          {save.status === "saved" && (
            <span style={{ color: "var(--vt-gold-400, #dca94b)", fontSize: 13 }}>✓ Saved</span>
          )}
          {save.status === "error" && (
            <span style={{ color: "#f87171", fontSize: 13 }}>{save.message}</span>
          )}
        </div>
      </form>
    </section>
  );
}

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
  const [topic, setTopic] = useState(initial.topic ?? "");
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
      prizeText !== (initial.prize_text ?? "") ||
      topic !== (initial.topic ?? "")
    );
  }, [name, primary, accent, logoUrl, heroUrl, sponsorName, sponsorUrl, sponsorLogoUrl, prizeText, topic, initial]);

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
    if (topic !== (initial.topic ?? ""))
      body.topic = trimmedOrNull(topic);

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
          topic: ok.syndicate.topic,
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

          <label className="vt-brand-field" style={{ gridColumn: "1 / -1" }}>
            <span className="vt-brand-label">
              Intro / description
              <span style={{ color: "#9aa6c2", fontWeight: 400, marginLeft: 6 }}>
                shown under your pool title on the share page
              </span>
            </span>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={600}
              rows={3}
              placeholder="A line or two about your pool. e.g. Office syndicate, World Cup 2026. Bragging rights and the trophy on the line."
              className="vt-brand-input vt-brand-textarea"
            />
          </label>

          <label className="vt-brand-field">
            <span className="vt-brand-label">Prize copy</span>
            <textarea
              value={prizeText}
              onChange={(e) => setPrizeText(e.target.value)}
              maxLength={600}
              rows={4}
              placeholder={
                "List your prizes, one per line. e.g.\n$250 voucher for 1st\n$100 for 2nd\n$50 for 3rd"
              }
              className="vt-brand-input vt-brand-textarea"
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

        {/* File uploaders -- replaced the URL inputs (Tim 2026-05-22).
            Each component does an in-browser canvas resize, POSTs the
            blob to /api/v1/syndicates/<slug>/branding-upload?kind=…,
            and calls onChange with the canonical /branding/<slug>/...
            URL the server stored. We then patch the DB with that URL
            on the next "Save changes" via the existing PATCH flow. */}
        <div className="vt-brand-grid">
          <div className="vt-brand-field">
            <BrandingImageUploader
              slug={slug}
              kind="logo"
              currentUrl={logoUrl || null}
              onChange={(u) => setLogoUrl(u ?? "")}
              label="Logo (square, 256px+)"
              hint="PNG or JPG. We square-crop and resize to 512x512."
            />
          </div>
          <div className="vt-brand-field">
            <BrandingImageUploader
              slug={slug}
              kind="hero"
              currentUrl={heroUrl || null}
              onChange={(u) => setHeroUrl(u ?? "")}
              label="Hero / banner (wide, 1200px+)"
              hint="Lands behind your pool name on the embed widget + share landing."
            />
          </div>
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

// --- Prize pool editor ------------------------------------------------

interface PrizeSplitRow {
  rank: number;
  percent: number;
  label: string;
}

const DEFAULT_PRESETS: ReadonlyArray<{
  label: string;
  split: ReadonlyArray<{ rank: number; percent: number; label: string }>;
}> = [
  {
    label: "Winner takes all",
    split: [{ rank: 1, percent: 100, label: "First" }],
  },
  {
    label: "75 / 20 / 5",
    split: [
      { rank: 1, percent: 75, label: "First" },
      { rank: 2, percent: 20, label: "Second" },
      { rank: 3, percent: 5, label: "Third" },
    ],
  },
  {
    label: "50 / 30 / 20",
    split: [
      { rank: 1, percent: 50, label: "First" },
      { rank: 2, percent: 30, label: "Second" },
      { rank: 3, percent: 20, label: "Third" },
    ],
  },
];

function parseSplit(json: string | null): PrizeSplitRow[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as Array<{
      rank?: number;
      percent?: number;
      label?: string | null;
    }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((e) => ({
      rank: Number(e.rank ?? 0),
      percent: Number(e.percent ?? 0),
      label: typeof e.label === "string" ? e.label : "",
    }));
  } catch {
    return [];
  }
}

interface PrizePoolEditorProps {
  readonly slug: string;
  readonly initial: OwnerSyndicate;
  readonly onSaved: (patch: Partial<OwnerSyndicate>) => void;
}

function PrizePoolEditor({ slug, initial, onSaved }: PrizePoolEditorProps): JSX.Element {
  const [entryEnabled, setEntryEnabled] = useState<boolean>(
    (initial.entry_fee_cents ?? 0) > 0,
  );
  const [entryDollars, setEntryDollars] = useState<string>(
    initial.entry_fee_cents ? (initial.entry_fee_cents / 100).toFixed(2) : "",
  );
  const [currency, setCurrency] = useState<string>(
    initial.entry_fee_currency ?? "NZD",
  );
  const [splits, setSplits] = useState<PrizeSplitRow[]>(
    parseSplit(initial.prize_split_json),
  );
  const [bonusText, setBonusText] = useState<string>(
    initial.bonus_prize_text ?? "",
  );
  const [feeTerms, setFeeTerms] = useState<string>(
    initial.join_fee_terms_text ?? "",
  );
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  const totalPercent = useMemo(
    () => splits.reduce((acc, r) => acc + (Number.isFinite(r.percent) ? r.percent : 0), 0),
    [splits],
  );
  const totalValid = Math.round(totalPercent) === 100 || splits.length === 0;

  const dirty = useMemo(() => {
    const newCents = entryEnabled
      ? Math.max(0, Math.round(parseFloat(entryDollars || "0") * 100))
      : null;
    const initialCents = initial.entry_fee_cents ?? null;
    if (newCents !== initialCents) return true;
    if ((currency || "NZD") !== (initial.entry_fee_currency ?? "NZD")) return true;
    const newJson = splits.length > 0 ? JSON.stringify(splits) : null;
    if (newJson !== (initial.prize_split_json ?? null)) return true;
    if (bonusText.trim() !== (initial.bonus_prize_text ?? "").trim()) return true;
    if (feeTerms.trim() !== (initial.join_fee_terms_text ?? "").trim()) return true;
    return false;
  }, [entryEnabled, entryDollars, currency, splits, bonusText, feeTerms, initial]);

  const applyPreset = (preset: (typeof DEFAULT_PRESETS)[number]): void => {
    setSplits(preset.split.map((s) => ({ ...s })));
  };

  const addSplitRow = (): void => {
    setSplits((cur) => [
      ...cur,
      { rank: cur.length + 1, percent: 0, label: "" },
    ]);
  };

  const removeSplitRow = (idx: number): void => {
    setSplits((cur) => cur.filter((_, i) => i !== idx));
  };

  const updateSplit = (idx: number, patch: Partial<PrizeSplitRow>): void => {
    setSplits((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!dirty) return;
    if (splits.length > 0 && !totalValid) {
      setSave({
        status: "error",
        message: `Prize split must sum to 100%. Current total: ${Math.round(totalPercent)}%.`,
      });
      return;
    }
    setSave({ status: "saving" });
    const body: Record<string, unknown> = {};

    const newCents = entryEnabled
      ? Math.max(0, Math.round(parseFloat(entryDollars || "0") * 100))
      : null;
    if (newCents !== (initial.entry_fee_cents ?? null)) {
      body.entry_fee_cents = newCents;
    }
    if ((currency || "NZD") !== (initial.entry_fee_currency ?? "NZD")) {
      body.entry_fee_currency = currency || null;
    }
    const newSplitArr = splits.length > 0
      ? splits.map((r) => ({
          rank: r.rank,
          percent: r.percent,
          label: r.label.trim() || null,
        }))
      : null;
    const newSplitJson = newSplitArr ? JSON.stringify(newSplitArr) : null;
    if (newSplitJson !== (initial.prize_split_json ?? null)) {
      body.prize_split = newSplitArr;
    }
    if (bonusText.trim() !== (initial.bonus_prize_text ?? "").trim()) {
      body.bonus_prize_text = bonusText.trim() || null;
    }
    if (feeTerms.trim() !== (initial.join_fee_terms_text ?? "").trim()) {
      body.join_fee_terms_text = feeTerms.trim() || null;
    }

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
          entry_fee_cents: ok.syndicate.entry_fee_cents,
          entry_fee_currency: ok.syndicate.entry_fee_currency,
          prize_split_json: ok.syndicate.prize_split_json,
          bonus_prize_text: ok.syndicate.bonus_prize_text,
          join_fee_terms_text: ok.syndicate.join_fee_terms_text,
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
          <h2 className="vt-dash-row-name">Prize pool & entry fee</h2>
          <p className="vt-dash-row-meta">
            Optional. Advertise an entry fee and how the pool splits. Tournamental
            never handles the money - on free, you collect and pay out yourself; on
            premium, Stripe inside your Growth Spurt-managed HighLevel sub-account handles
            the cash and the funds settle to your bank.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="vt-brand-form">
        {/* Entry fee toggle + amount */}
        <label className="vt-brand-checkbox-row">
          <input
            type="checkbox"
            checked={entryEnabled}
            onChange={(e) => setEntryEnabled(e.target.checked)}
          />
          <span>Charge an entry fee</span>
        </label>

        {entryEnabled && (
          <div className="vt-brand-grid">
            <label className="vt-brand-field">
              <span className="vt-brand-label">Entry fee</span>
              <div className="vt-brand-fee-row">
                <input
                  type="text"
                  inputMode="decimal"
                  value={entryDollars}
                  onChange={(e) =>
                    setEntryDollars(e.target.value.replace(/[^\d.]/g, ""))
                  }
                  placeholder="10.00"
                  className="vt-brand-input"
                />
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="vt-brand-input"
                  style={{ maxWidth: 96 }}
                >
                  <option>NZD</option>
                  <option>AUD</option>
                  <option>USD</option>
                  <option>GBP</option>
                  <option>EUR</option>
                </select>
              </div>
            </label>
          </div>
        )}

        {/* Prize split */}
        <div className="vt-brand-field">
          <span className="vt-brand-label">Prize split</span>
          <div className="vt-brand-presets">
            <span className="vt-brand-label" style={{ fontSize: 11 }}>Quick presets:</span>
            <div className="vt-brand-preset-row">
              {DEFAULT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="vt-suggestion-chip-dash"
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {splits.length === 0 && (
            <p className="vt-brand-empty">
              No split defined yet. Pick a preset above, or click "Add prize" to build one manually.
            </p>
          )}
          {splits.length > 0 && (
            <div className="vt-prize-split-table">
              {splits.map((row, idx) => (
                <div key={idx} className="vt-prize-split-row">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={row.rank}
                    onChange={(e) => updateSplit(idx, { rank: Number(e.target.value) })}
                    className="vt-brand-input"
                    style={{ maxWidth: 60 }}
                    aria-label="Rank"
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={row.percent}
                    onChange={(e) => updateSplit(idx, { percent: Number(e.target.value) })}
                    className="vt-brand-input"
                    style={{ maxWidth: 90 }}
                    aria-label="Percent"
                  />
                  <span className="vt-prize-split-pct">%</span>
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateSplit(idx, { label: e.target.value })}
                    placeholder="e.g. First place"
                    className="vt-brand-input"
                    aria-label="Label"
                  />
                  <button
                    type="button"
                    onClick={() => removeSplitRow(idx)}
                    className="vt-prize-split-remove"
                    aria-label="Remove this prize tier"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="vt-prize-split-total" data-valid={totalValid}>
                Total: {Math.round(totalPercent * 10) / 10}%{" "}
                {totalValid ? "✓" : "(must be 100%)"}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={addSplitRow}
            className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
            style={{ alignSelf: "flex-start", marginTop: 8 }}
          >
            + Add prize
          </button>
        </div>

        {/* Bonus prize */}
        <label className="vt-brand-field">
          <span className="vt-brand-label">Bonus prize (optional)</span>
          <input
            type="text"
            value={bonusText}
            onChange={(e) => setBonusText(e.target.value)}
            maxLength={280}
            placeholder='e.g. "Longest correct-streak gets a $50 gift card"'
            className="vt-brand-input"
          />
        </label>

        {/* Joining fee terms + payment instructions. Shown to joiners on
            the /s/<slug>/join flow for paid pools. Tournamental never
            handles the money; the owner collects it directly. */}
        <label className="vt-brand-field">
          <span className="vt-brand-label">Joining fee terms &amp; payment instructions</span>
          <textarea
            value={feeTerms}
            onChange={(e) => setFeeTerms(e.target.value)}
            maxLength={2000}
            rows={6}
            placeholder={
              "How to pay and any terms. e.g.\n\n" +
              "Pay $10 to bank 12-3456-7890123-00, reference your handle.\n" +
              "Entry closes at kickoff. Prizes paid out within 7 days of the final."
            }
            className="vt-brand-input vt-brand-textarea"
          />
          <span
            className="vt-brand-label"
            style={{ fontSize: 11, opacity: 0.75, marginTop: 4 }}
          >
            Shown to joiners on paid pools. Tournamental never handles the money,
            you collect and pay out yourself.
          </span>
        </label>

        <div className="vt-brand-actions">
          <button
            type="submit"
            disabled={!dirty || save.status === "saving" || !totalValid}
            className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
          >
            {save.status === "saving" ? "Saving…" : dirty ? "Save prize pool" : "Saved"}
          </button>
          {save.status === "saved" && (
            <span className="vt-brand-status vt-brand-status-ok">✓ Saved</span>
          )}
          {save.status === "error" && (
            <span className="vt-brand-status vt-brand-status-err">{save.message}</span>
          )}
        </div>
      </form>
    </section>
  );
}

/* ─── Approve / deny banner ────────────────────────────────────────
 *
 * The GET approve/deny email-link routes redirect to this page with a
 * `?request=approved|denied|already-handled` query param. Render a
 * dismissible banner so the owner gets confirmation of the action.
 * Tim 2026-05-22.
 */
function RequestBanner(): JSX.Element | null {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const r = params.get("request");
    if (!r) return;
    setStatus(r);
    // Strip the query param from the URL so a refresh doesn't replay
    // the banner.
    params.delete("request");
    const clean =
      window.location.pathname +
      (params.toString() ? `?${params.toString()}` : "") +
      window.location.hash;
    window.history.replaceState(null, "", clean);
  }, []);

  if (!status) return null;

  const tone =
    status === "approved"
      ? { bg: "rgba(34, 197, 94, 0.12)", border: "rgba(34, 197, 94, 0.6)", icon: "✅", text: "Request approved. The member is now on your leaderboard." }
      : status === "denied"
        ? { bg: "rgba(239, 68, 68, 0.12)", border: "rgba(239, 68, 68, 0.6)", icon: "🚫", text: "Request denied. The user can't rejoin under the same account." }
        : { bg: "rgba(220, 169, 75, 0.10)", border: "rgba(220, 169, 75, 0.45)", icon: "ℹ️", text: "That request was already handled." };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 14,
        fontSize: 14,
        color: "var(--vt-fg, #f4f4f5)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span aria-hidden>{tone.icon}</span>
      <span>{tone.text}</span>
      <button
        type="button"
        onClick={() => setStatus(null)}
        aria-label="Dismiss"
        style={{
          marginLeft: "auto",
          background: "transparent",
          border: 0,
          color: "var(--vt-fg-muted, #a3a3ad)",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

/* ─── Pending-requests panel ───────────────────────────────────────
 *
 * Shows the approval queue for pools where `requires_approval=1`.
 * Each row has Approve / Deny buttons that POST to the
 * session-authenticated dashboard endpoint and optimistically remove
 * the row on success. Empty list → panel hides entirely so unapproved
 * pools don't see a stale "0 requests" box.
 */
function PendingRequestsPanel({
  slug,
  initialRequests,
}: {
  slug: string;
  initialRequests: PendingRequest[];
}): JSX.Element | null {
  const [requests, setRequests] = useState<PendingRequest[]>(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Keep local list in sync if the parent re-fetches (e.g. after a
  // branding save). React preserves children state across re-renders
  // but the initialRequests reference changes when the parent state
  // refreshes, so we sync on prop change.
  useEffect(() => {
    setRequests(initialRequests);
  }, [initialRequests]);

  if (requests.length === 0) return null;

  const decide = async (
    userId: string,
    action: "approve" | "deny",
  ): Promise<void> => {
    setBusyId(userId);
    try {
      const r = await fetch(
        `/api/v1/syndicates/${encodeURIComponent(slug)}/join-requests/${encodeURIComponent(userId)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setToast(`Couldn't ${action}: ${body.error ?? `HTTP ${r.status}`}`);
        window.setTimeout(() => setToast(null), 4000);
        return;
      }
      setRequests((prev) => prev.filter((p) => p.user_id !== userId));
      setToast(action === "approve" ? "Approved ✓" : "Denied");
      window.setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setToast(
        e instanceof Error ? `Network error: ${e.message}` : "Network error",
      );
      window.setTimeout(() => setToast(null), 4000);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      className="vt-dash-row"
      style={{ marginBottom: 16, borderColor: "rgba(220, 169, 75, 0.32)" }}
      aria-labelledby="vt-pending-title"
    >
      <div className="vt-dash-row-head">
        <div>
          <h2 className="vt-dash-row-name" id="vt-pending-title">
            Pending requests
            <span
              style={{
                marginLeft: 10,
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(252, 211, 77, 0.18)",
                border: "1px solid rgba(220, 169, 75, 0.45)",
                color: "#fcd34d",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              {requests.length}
            </span>
          </h2>
          <p className="vt-dash-row-meta">
            {requests.length === 1
              ? "Someone has requested to join your pool. Approve them to add them to the leaderboard."
              : `${requests.length} people have requested to join your pool. Approve or deny each below.`}
          </p>
        </div>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {requests.map((p) => {
          const label = p.display_name?.trim()
            ? `${p.display_name.trim()} · @${p.handle ?? p.user_id.slice(0, 6)}`
            : `@${p.handle ?? p.user_id.slice(0, 6)}`;
          const requestedAt = new Date(p.joined_at);
          const requestedLabel = Number.isFinite(requestedAt.getTime())
            ? requestedAt.toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "-";
          return (
            <li
              key={p.user_id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 10,
              }}
            >
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    color: "var(--vt-fg, #f4f4f5)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--vt-fg-muted, #a3a3ad)",
                    marginTop: 2,
                  }}
                >
                  Requested {requestedLabel}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                <button
                  type="button"
                  className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
                  onClick={() => {
                    void decide(p.user_id, "deny");
                  }}
                  disabled={busyId === p.user_id}
                >
                  Deny
                </button>
                <button
                  type="button"
                  className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
                  onClick={() => {
                    void decide(p.user_id, "approve");
                  }}
                  disabled={busyId === p.user_id}
                >
                  {busyId === p.user_id ? "…" : "Approve"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {toast && (
        <p
          role="status"
          aria-live="polite"
          style={{
            margin: "8px 0 0",
            fontSize: 13,
            color: "var(--vt-fg-muted, #a3a3ad)",
          }}
        >
          {toast}
        </p>
      )}
    </section>
  );
}
