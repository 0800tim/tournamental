"use client";

/**
 * JoinFlowClient - the client state machine behind /s/[guid]/join.
 *
 * A focused, branded join page rendered without the app shell/nav. It
 * walks a visitor from cold to in-the-pool:
 *
 *   loading     -> fetch the pool config + detect any existing session
 *   signin      -> not signed in: pool logo + name + prize summary, then
 *                  WhatsApp / email-OTP / paste-a-code, plus NZ-AU SMS
 *   onboarding  -> signed in, not a member: handle + display name + avatar
 *   payment     -> paid pool with admin terms: show terms + "I agree"
 *   done        -> joined (active) or request sent (pending), with a CTA
 *
 * The pool's branding.primary_colour drives buttons (default #fbbf24);
 * everything is dark-theme, self-contained inline styles so the page is
 * just the invite, no global CSS dependency.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  detectSmsCountry,
  fetchInboundUser,
  requestEmailOtp,
  requestPhoneOtp,
  smsLoginDeepLink,
  updateInboundProfile,
  verifyEmailOtp,
  verifyInboundCode,
  whatsAppLoginDeepLink,
  type InboundUser,
} from "@/lib/auth/inbound-login";
import { AvatarUploader } from "@/components/profile/AvatarUploader";

const DEFAULT_PRIMARY = "#fbbf24";
const HANDLE_RE = /^[a-zA-Z0-9_]{2,32}$/;

/**
 * Dedupe key -> epoch-ms of the last warm-invite OTP burst we fired.
 * Module-level (not useRef) so React StrictMode's mount-unmount-mount
 * dance in dev doesn't double-fire the per-phone rate-limited OTP
 * endpoint. Cleared automatically by the TTL check in WarmInviteStep.
 */
const WARM_INVITE_FIRED_AT = new Map<string, number>();

export interface JoinFlowClientProps {
  readonly slug: string;
  readonly initialName: string;
}

type FlowState =
  | "loading"
  | "warm-invite"
  | "signin"
  | "onboarding"
  | "payment"
  | "done";

/** Pre-fill fields parsed from the CRM-invite query string. Any subset
 *  may be present. When `mobile` or `email` is set, the join page kicks
 *  off the OTP send automatically and skips the manual sign-in step.
 *  Tim 2026-05-28. */
interface WarmInvite {
  readonly firstname: string | null;
  readonly surname: string | null;
  readonly mobile: string | null;
  readonly email: string | null;
}

function parseWarmInvite(search: string): WarmInvite | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(search);
  const pick = (k: string): string | null => {
    const v = params.get(k);
    if (!v) return null;
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  // Accept either spelling for each field so CRM exports with slightly
  // different column headers still work without an integration step.
  const firstname = pick("firstname") ?? pick("first_name") ?? pick("first") ?? null;
  const surname =
    pick("surname") ?? pick("lastname") ?? pick("last_name") ?? pick("last") ?? null;
  const mobile = pick("mobile") ?? pick("phone") ?? null;
  const email = pick("email") ?? null;
  if (!firstname && !surname && !mobile && !email) return null;
  return { firstname, surname, mobile, email };
}

interface EntryFee {
  readonly cents: number;
  readonly currency: string;
}

interface PoolConfig {
  readonly name: string;
  readonly tournament_id?: string;
  readonly topic?: string | null;
  readonly owner_handle?: string | null;
  readonly member_count?: number;
  readonly branding: {
    readonly logo_url: string | null;
    readonly hero_url?: string | null;
    readonly primary_colour: string | null;
    readonly accent_colour: string | null;
  };
  readonly prize_text: string | null;
  readonly prize_split: unknown;
  readonly bonus_prize_text: string | null;
  readonly entry_fee: EntryFee | null;
  readonly requires_approval: boolean;
  readonly is_public: boolean;
  readonly join_fee_terms_text: string | null;
}

interface PrizeSplitEntry {
  readonly rank?: number;
  readonly percent?: number;
  readonly label?: string | null;
}

/** Membership status returned by GET /join for a signed-in user. */
type JoinStatus = "owner" | "active" | "pending" | "denied" | "none";

type DoneKind = "active" | "pending" | "already";

function formatFee(fee: EntryFee | null): string {
  if (!fee || fee.cents <= 0) return "Free to enter";
  const amount = (fee.cents / 100).toFixed(2).replace(/\.00$/, "");
  return `${fee.currency} ${amount} to enter`;
}

export function JoinFlowClient({ slug, initialName }: JoinFlowClientProps): JSX.Element {
  const [flow, setFlow] = useState<FlowState>("loading");
  const [config, setConfig] = useState<PoolConfig | null>(null);
  const [user, setUser] = useState<InboundUser | null>(null);
  const [doneKind, setDoneKind] = useState<DoneKind>("active");
  const [loadError, setLoadError] = useState<string | null>(null);
  // CRM-invite pre-fill from query string. Captured once on mount so
  // a later history.replaceState() (we strip the params after sending
  // so they don't leak via referrer / share) doesn't lose them.
  const [warmInvite] = useState<WarmInvite | null>(() =>
    typeof window === "undefined" ? null : parseWarmInvite(window.location.search),
  );

  const primary = config?.branding.primary_colour || DEFAULT_PRIMARY;

  // --- Initial load: pool config + session + membership ---------------
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      // 1) Pool config (public, no auth).
      let cfg: PoolConfig | null = null;
      try {
        const r = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/config`, {
          headers: { Accept: "application/json" },
        });
        if (r.ok) {
          const j = (await r.json()) as { syndicate?: PoolConfig };
          cfg = j.syndicate ?? null;
        }
      } catch {
        /* fall through to error */
      }
      if (cancelled) return;
      if (!cfg) {
        setLoadError("We couldn't load this pool. Try again in a moment.");
        setFlow("signin");
        return;
      }
      setConfig(cfg);

      // 2) Existing session?
      const u = await fetchInboundUser();
      if (cancelled) return;
      if (!u) {
        // CRM-invite path: when the URL carried at least an email
        // or mobile, jump straight to the warm-invite step which
        // auto-sends the OTP and only asks for the code. Otherwise
        // fall through to the standard sign-in step.
        if (warmInvite && (warmInvite.email || warmInvite.mobile)) {
          setFlow("warm-invite");
          return;
        }
        setFlow("signin");
        return;
      }
      setUser(u);

      // 3) Already a member / owner / pending?
      const status = await fetchMembershipStatus(slug);
      if (cancelled) return;
      routeSignedIn(status);
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  /** Decide where a signed-in user lands based on membership status. */
  const routeSignedIn = useCallback((status: JoinStatus): void => {
    if (status === "owner" || status === "active") {
      setDoneKind("already");
      setFlow("done");
      return;
    }
    if (status === "pending") {
      setDoneKind("pending");
      setFlow("done");
      return;
    }
    setFlow("onboarding");
  }, []);

  /** Called by the sign-in step after a successful inline verify. */
  const handleSignedIn = useCallback(
    async (verifiedUser: InboundUser | null): Promise<void> => {
      if (verifiedUser) setUser(verifiedUser);
      const fresh = verifiedUser ?? (await fetchInboundUser());
      if (fresh) setUser(fresh);
      const status = await fetchMembershipStatus(slug);
      routeSignedIn(status);
    },
    [slug, routeSignedIn],
  );

  if (flow === "loading") {
    return (
      <Shell primary={primary}>
        <p style={{ color: "#9aa6c2" }}>Loading…</p>
      </Shell>
    );
  }

  if (flow === "warm-invite" && warmInvite) {
    return (
      <Shell primary={primary}>
        <PoolHeader config={config} initialName={initialName} />
        <PrizeSummary config={config} />
        {loadError && <p style={errorTextStyle}>{loadError}</p>}
        <WarmInviteStep
          slug={slug}
          primary={primary}
          invite={warmInvite}
          onSignedIn={handleSignedIn}
          onFallback={() => setFlow("signin")}
        />
      </Shell>
    );
  }

  if (flow === "signin") {
    return (
      <Shell primary={primary}>
        <PoolHeader config={config} initialName={initialName} />
        <PrizeSummary config={config} />
        {loadError && <p style={errorTextStyle}>{loadError}</p>}
        <SignInStep slug={slug} primary={primary} onSignedIn={handleSignedIn} />
      </Shell>
    );
  }

  if (flow === "onboarding" && user) {
    return (
      <Shell primary={primary}>
        <PoolHeader config={config} initialName={initialName} />
        <OnboardingStep
          slug={slug}
          primary={primary}
          user={user}
          config={config}
          onPayment={() => setFlow("payment")}
          onJoined={(status) => {
            setDoneKind(status === "pending" ? "pending" : "active");
            setFlow("done");
          }}
        />
      </Shell>
    );
  }

  if (flow === "payment" && config) {
    return (
      <Shell primary={primary}>
        <PoolHeader config={config} initialName={initialName} />
        <PaymentStep
          slug={slug}
          primary={primary}
          config={config}
          user={user}
          onJoined={(status) => {
            setDoneKind(status === "pending" ? "pending" : "active");
            setFlow("done");
          }}
        />
      </Shell>
    );
  }

  // done
  return (
    <Shell primary={primary}>
      <PoolHeader config={config} initialName={initialName} />
      <DoneStep kind={doneKind} primary={primary} />
    </Shell>
  );
}

// --- Membership probe -------------------------------------------------

async function fetchMembershipStatus(slug: string): Promise<JoinStatus> {
  try {
    const r = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/join`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return "none";
    const j = (await r.json()) as { is_owner?: boolean; status?: JoinStatus };
    if (j.is_owner) return "owner";
    return j.status ?? "none";
  } catch {
    return "none";
  }
}

// --- Layout shell -----------------------------------------------------

function Shell({
  primary: _primary,
  children,
}: {
  primary: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0e0e12",
        color: "#e7ecf7",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {children}
      </div>
    </main>
  );
}

function PoolHeader({
  config,
  initialName,
}: {
  config: PoolConfig | null;
  initialName: string;
}): JSX.Element {
  const name = config?.name ?? initialName;
  const logo = config?.branding.logo_url ?? null;
  const hero = config?.branding.hero_url ?? null;
  const topic = (config?.topic ?? "").trim() || null;
  const ownerHandle = (config?.owner_handle ?? "").trim() || null;
  const tournament =
    config?.tournament_id === "fifa-wc-2026"
      ? "FIFA World Cup 2026™ Predictor"
      : "Tournamental";

  // Branded page-header mirrors the share-landing surface at /s/<slug>:
  // hero banner background → scrim → logo chip + dateline + name +
  // lede. Falls back to a clean centred logo+name when no branding is
  // configured so a fresh free pool still reads as inviting. Inline
  // styles (no global CSS) so the join page stays self-contained.
  // Tim 2026-05-28.
  if (!hero && !logo) {
    return (
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <p style={{ color: "#9aa6c2", letterSpacing: "0.14em", textTransform: "uppercase", fontSize: 11, margin: 0 }}>
          You&apos;re invited to join
        </p>
        <h1 style={{ fontSize: 28, margin: 0, fontFamily: "Fraunces, Georgia, serif", letterSpacing: "-0.01em" }}>
          {name}
        </h1>
        {topic && (
          <p style={{ color: "#c7d0e6", fontSize: 14, fontStyle: "italic", margin: "4px 0 0", fontFamily: "Fraunces, Georgia, serif" }}>
            {topic}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        borderRadius: 16,
        overflow: "hidden",
        marginBottom: 4,
        background: "#15151a",
        border: "1px solid rgba(255,255,255,0.06)",
        minHeight: 180,
      }}
    >
      {hero && (
        <div
          role="img"
          aria-label={`${name} banner`}
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url(${JSON.stringify(hero).slice(1, -1)})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}
      {/* Scrim so light hero images don't wash out the text */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(15,15,20,0.55) 0%, rgba(15,15,20,0.92) 100%)",
        }}
      />
      <div
        style={{
          position: "relative",
          padding: "20px 18px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt=""
              style={{
                width: 64,
                height: 64,
                objectFit: "contain",
                borderRadius: 10,
                background: "#fff",
                padding: 4,
                boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                flexShrink: 0,
              }}
            />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <p
              style={{
                color: "#dca94b",
                fontFamily:
                  '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                margin: 0,
              }}
            >
              <span aria-hidden style={{ marginRight: 8 }}>—</span>
              {tournament}
              {ownerHandle && (
                <>
                  <span aria-hidden style={{ margin: "0 8px" }}>·</span>
                  <span>@{ownerHandle}</span>
                </>
              )}
            </p>
            <h1
              style={{
                fontFamily: "Fraunces, Georgia, serif",
                fontWeight: 500,
                fontSize: "clamp(28px, 6vw, 40px)",
                lineHeight: 1.05,
                letterSpacing: "-0.01em",
                color: "#ffffff",
                margin: "6px 0 0",
              }}
            >
              {name}
            </h1>
          </div>
        </div>
        {topic && (
          <p
            style={{
              fontFamily: "Fraunces, Georgia, serif",
              fontStyle: "italic",
              fontSize: 15,
              lineHeight: 1.45,
              color: "#e6e6ea",
              margin: "8px 2px 0",
            }}
          >
            {topic}
          </p>
        )}
      </div>
    </div>
  );
}

function PrizeSummary({ config }: { config: PoolConfig | null }): JSX.Element | null {
  if (!config) return null;
  const splits = Array.isArray(config.prize_split)
    ? (config.prize_split as PrizeSplitEntry[])
    : [];
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        textAlign: "center",
      }}
    >
      <strong style={{ fontSize: 14 }}>{formatFee(config.entry_fee)}</strong>
      {config.prize_text && (
        <p style={{ margin: 0, color: "#c7d0e6", fontSize: 13, whiteSpace: "pre-wrap" }}>
          {config.prize_text}
        </p>
      )}
      {splits.length > 0 && !config.prize_text && (
        <p style={{ margin: 0, color: "#c7d0e6", fontSize: 13 }}>
          {splits
            .slice(0, 3)
            .map((s) => `${rankLabel(s.rank)}: ${s.percent ?? 0}%`)
            .join("  ·  ")}
        </p>
      )}
      {config.bonus_prize_text && (
        <p style={{ margin: 0, color: "#9aa6c2", fontSize: 12 }}>{config.bonus_prize_text}</p>
      )}
    </div>
  );
}

function rankLabel(rank: number | undefined): string {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return rank ? `${rank}th` : "";
}

// --- Sign-in step -----------------------------------------------------

type EmailPhase = "idle" | "sending" | "code-sent";

function SignInStep({
  slug,
  primary,
  onSignedIn,
}: {
  slug: string;
  primary: string;
  onSignedIn: (user: InboundUser | null) => void | Promise<void>;
}): JSX.Element {
  const [email, setEmail] = useState("");
  const [emailPhase, setEmailPhase] = useState<EmailPhase>("idle");
  const [emailCode, setEmailCode] = useState("");
  const [pasteCode, setPasteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const smsCountry = useMemo(() => detectSmsCountry(), []);

  const sendEmailCode = async (): Promise<void> => {
    setError(null);
    setEmailPhase("sending");
    const res = await requestEmailOtp(email);
    if (res.ok) {
      setEmailPhase("code-sent");
    } else {
      setEmailPhase("idle");
      setError(
        res.error === "cooldown" || res.error === "hourly-cap"
          ? "Too many requests. Wait a moment and try again."
          : res.error === "bad-body"
            ? "Enter a valid email address."
            : "Couldn't send the code. Try again or use WhatsApp.",
      );
    }
  };

  const verifyEmail = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    const res = await verifyEmailOtp(email, emailCode);
    setBusy(false);
    if (res.ok) {
      void onSignedIn({
        id: res.user.id,
        phone: res.user.phone,
        email: null,
        displayName: res.user.displayName,
        firstName: null,
        lastName: null,
        country: res.user.country,
        city: null,
        favouriteTeamCode: null,
        telegramUsername: null,
        createdAt: 0,
        lastSeenAt: 0,
      });
    } else {
      setError(verifyErrorMessage(res.error));
    }
  };

  const verifyPaste = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    const res = await verifyInboundCode(pasteCode);
    setBusy(false);
    if (res.ok) {
      void onSignedIn({
        id: res.user.id,
        phone: res.user.phone,
        email: null,
        displayName: res.user.displayName,
        firstName: null,
        lastName: null,
        country: res.user.country,
        city: null,
        favouriteTeamCode: null,
        telegramUsername: null,
        createdAt: 0,
        lastSeenAt: 0,
      });
    } else {
      setError(verifyErrorMessage(res.error));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {error && <p style={errorTextStyle}>{error}</p>}

      {/* WhatsApp */}
      <a
        href={whatsAppLoginDeepLink(slug)}
        style={primaryButtonStyle(primary)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Sign in with WhatsApp
      </a>

      <Divider label="or with email" />

      {/* Email OTP */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        {emailPhase !== "code-sent" ? (
          <button
            type="button"
            onClick={() => void sendEmailCode()}
            disabled={emailPhase === "sending" || !email}
            style={ghostButtonStyle(primary)}
          >
            {emailPhase === "sending" ? "Sending…" : "Email me a code"}
          </button>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit code"
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              style={inputStyle}
            />
            <button
              type="button"
              onClick={() => void verifyEmail()}
              disabled={busy || emailCode.length !== 6}
              style={primaryButtonStyle(primary)}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </>
        )}
      </div>

      <Divider label="already have a code?" />

      {/* Paste-a-code */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="Paste your 6-digit code"
          value={pasteCode}
          onChange={(e) => setPasteCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          style={inputStyle}
        />
        <button
          type="button"
          onClick={() => void verifyPaste()}
          disabled={busy || pasteCode.length !== 6}
          style={ghostButtonStyle(primary)}
        >
          {busy ? "Signing in…" : "Use code"}
        </button>
      </div>

      {/* SMS - NZ/AU only, at the very bottom */}
      {(smsCountry === "NZ" || smsCountry === "AU") && (
        <a
          href={smsLoginDeepLink(slug)}
          style={{
            textAlign: "center",
            color: "#9aa6c2",
            fontSize: 13,
            textDecoration: "underline",
            marginTop: 4,
          }}
        >
          Or sign in by SMS
        </a>
      )}
    </div>
  );
}

function verifyErrorMessage(error: string): string {
  switch (error) {
    case "unknown-or-expired":
      return "That code has expired or already been used. Request a fresh one.";
    case "fingerprint-mismatch":
      return "That code was issued on a different device. Use the device you requested it from.";
    case "ip-throttled":
      return "Too many attempts. Wait a few minutes and try again.";
    case "bad-body":
      return "Enter the full 6-digit code.";
    case "network":
      return "Couldn't reach the sign-in service. Check your connection.";
    default:
      return "Sign-in failed. Try again, or use WhatsApp.";
  }
}

// --- Warm-invite step (CRM pre-fill) ----------------------------------

/**
 * CRM-invite landing. When the join URL carries pre-filled contact
 * details (`?firstname=...&surname=...&mobile=...&email=...`) we skip
 * the manual sign-in form and:
 *
 *   1. Auto-dispatch the OTP on mount: WhatsApp to mobile if present
 *      AND email to address if present (both fire in parallel).
 *   2. Greet the recipient by name.
 *   3. Show ONE code input. `verifyInboundCode` matches any active
 *      OTP regardless of channel, so the recipient enters whichever
 *      code arrived first.
 *   4. After verify, write firstname / surname / email back to the
 *      profile so the onboarding step is already filled in.
 *
 * Tim 2026-05-28.
 */
function WarmInviteStep({
  slug,
  primary,
  invite,
  onSignedIn,
  onFallback,
}: {
  slug: string;
  primary: string;
  invite: WarmInvite;
  onSignedIn: (user: InboundUser | null) => void | Promise<void>;
  onFallback: () => void;
}): JSX.Element {
  const greetName = [invite.firstname, invite.surname].filter(Boolean).join(" ").trim();
  const [sendState, setSendState] = useState<"sending" | "sent" | "error">("sending");
  const [sentVia, setSentVia] = useState<{
    email: boolean;
    whatsapp: boolean;
    sms: boolean;
  }>({ email: false, whatsapp: false, sms: false });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fire the OTP sends once per (slug + email + mobile) tuple. The
  // dedupe map is MODULE-level on purpose: React StrictMode dev runs
  // every effect twice with a full unmount+remount in between, so a
  // useRef would reset. Without this guard each load fired 2 sends
  // per channel, tripping the per-phone 20s cooldown immediately
  // (Tim 2026-05-28 — saw 4 duplicate /v1/auth/request calls).
  useEffect(() => {
    const key = `${slug}|${invite.email ?? ""}|${invite.mobile ?? ""}`;
    const now = Date.now();
    const lastFiredAt = WARM_INVITE_FIRED_AT.get(key) ?? 0;
    if (now - lastFiredAt < 30_000) {
      // Already dispatched recently. Skip the network call but still
      // surface "sent" so the UI doesn't sit in the sending spinner
      // forever on the StrictMode remount. We don't know which channel
      // actually landed last time so claim email + the first phone
      // channel (whatsapp); the user sees one accurate channel and the
      // verifier matches whichever code they paste.
      setSendState("sent");
      setSentVia({
        email: !!invite.email,
        whatsapp: !!invite.mobile,
        sms: false,
      });
      return;
    }
    WARM_INVITE_FIRED_AT.set(key, now);

    let cancelled = false;
    void (async () => {
      // Email always fires in parallel — it's the most reliable channel
      // and recipients often prefer it. The phone path is sequential:
      // try WhatsApp first; if it fails, fall back to SMS so the user
      // never misses the code because the WhatsApp delivery had a
      // transient hiccup (Tim 2026-05-28).
      const emailP = invite.email
        ? requestEmailOtp(invite.email)
        : Promise.resolve(null);

      let waOk = false;
      let smsOk = false;
      if (invite.mobile) {
        const wa = await requestPhoneOtp(invite.mobile, "whatsapp", slug);
        if (!cancelled) waOk = (wa as { ok?: boolean } | null)?.ok === true;
        // SMS fallback is intentionally GATED OFF until the Aiva-SMS
        // gateway ships tenant-scoped API keys + a Tournamental SIM
        // enrolment (see docs/aiva-sms-tenant-scoping-brief.md).
        // Until then, our admin-scoped key sends SMS from SDEAL's or
        // MyFurbaby's number, which would actively confuse recipients
        // and break the brand audit trail. Email + WhatsApp cover the
        // happy path; WhatsApp is reliable enough that the fallback
        // shouldn't fire in practice anyway. Re-enable by flipping
        // this constant once the brief is closed out (Tim 2026-05-28).
        const SMS_FALLBACK_ENABLED = false;
        if (!waOk && !cancelled && SMS_FALLBACK_ENABLED) {
          const sms = await requestPhoneOtp(invite.mobile, "sms", slug);
          if (!cancelled) smsOk = (sms as { ok?: boolean } | null)?.ok === true;
        }
      }

      const emailRes = await emailP;
      if (cancelled) return;
      const emailOk = (emailRes as { ok?: boolean } | null)?.ok === true;

      setSentVia({ email: emailOk, whatsapp: waOk, sms: smsOk });
      if (emailOk || waOk || smsOk) setSendState("sent");
      else setSendState("error");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const channelLine = useMemo(() => {
    const bits: string[] = [];
    if (sentVia.whatsapp) bits.push("WhatsApp");
    else if (sentVia.sms) bits.push("SMS");
    if (sentVia.email) bits.push("email");
    if (bits.length === 0) return "Sending you a code…";
    return `Code sent via ${bits.join(" + ")}. Enter it below to join.`;
  }, [sentVia]);

  const handleVerify = useCallback(async (): Promise<void> => {
    setError(null);
    setBusy(true);
    // Email + phone OTPs live in DIFFERENT auth-sms tables, so the
    // /v1/auth/verify-by-code endpoint (which scans phone OTPs) misses
    // email codes and returns "unknown-or-expired". Try the email path
    // first when we have an email address; if that fails, fall through
    // to the inbound (phone) scan. The user enters whichever code
    // arrived first; the verifier figures out which row to match.
    let res: Awaited<ReturnType<typeof verifyInboundCode>> | null = null;
    if (invite.email) {
      const r = await verifyEmailOtp(invite.email, code);
      if (r.ok) res = r;
    }
    if (!res) {
      res = await verifyInboundCode(code);
    }
    if (!res.ok) {
      setBusy(false);
      setError(verifyErrorMessage(res.error));
      return;
    }
    // Profile pre-fill: write the invite-provided name + email back
    // so the onboarding step already has them filled in. Best-effort;
    // a failure here doesn't block sign-in.
    const displayName = [invite.firstname, invite.surname].filter(Boolean).join(" ").trim();
    const patch: Record<string, string> = {};
    if (invite.firstname) patch.first_name = invite.firstname;
    if (invite.surname) patch.last_name = invite.surname;
    if (invite.email) patch.email = invite.email;
    if (displayName) patch.display_name = displayName;
    try {
      if (Object.keys(patch).length > 0) {
        await updateInboundProfile(patch as Parameters<typeof updateInboundProfile>[0]);
      }
    } catch {
      /* swallow: not fatal */
    }
    setBusy(false);
    void onSignedIn({
      id: res.user.id,
      phone: res.user.phone,
      email: invite.email,
      displayName: displayName || res.user.displayName,
      firstName: invite.firstname,
      lastName: invite.surname,
      country: res.user.country,
      city: null,
      favouriteTeamCode: null,
      telegramUsername: null,
      createdAt: 0,
      lastSeenAt: 0,
    });
  }, [code, invite, onSignedIn]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {greetName && (
        <p style={{ fontSize: 18, color: "#e6e6ea", margin: 0, fontWeight: 600 }}>
          Welcome, {greetName}.
        </p>
      )}
      <p style={{ color: "#c7d0e6", fontSize: 14, margin: 0 }}>
        {sendState === "sending"
          ? "Sending you a one-time code…"
          : sendState === "error"
            ? "We couldn't send the code automatically. Use the sign-in below."
            : channelLine}
      </p>

      {error && <p style={errorTextStyle}>{error}</p>}

      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        style={inputStyle}
        autoFocus
        disabled={sendState === "error"}
      />
      <button
        type="button"
        onClick={() => void handleVerify()}
        disabled={busy || code.length !== 6 || sendState === "error"}
        style={primaryButtonStyle(primary)}
      >
        {busy ? "Joining…" : "Join the pool"}
      </button>

      <button
        type="button"
        onClick={onFallback}
        style={{
          background: "transparent",
          border: 0,
          color: "#9aa6c2",
          fontSize: 13,
          textDecoration: "underline",
          padding: 4,
          marginTop: 4,
          cursor: "pointer",
        }}
      >
        {sendState === "error" ? "Sign in manually" : "Use a different sign-in method"}
      </button>
    </div>
  );
}

// --- Onboarding step --------------------------------------------------

function OnboardingStep({
  slug,
  primary,
  user,
  config,
  onPayment,
  onJoined,
}: {
  slug: string;
  primary: string;
  user: InboundUser;
  config: PoolConfig | null;
  onPayment: () => void;
  onJoined: (status: "active" | "pending") => void;
}): JSX.Element {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleValid = HANDLE_RE.test(handle);

  // Debounced availability check.
  useEffect(() => {
    if (!handleValid) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/handle-check?handle=${encodeURIComponent(handle)}`,
          { headers: { Accept: "application/json" } },
        );
        if (cancelled) return;
        if (r.ok) {
          const j = (await r.json()) as { available?: boolean };
          setAvailable(j.available ?? null);
        } else {
          setAvailable(null);
        }
      } catch {
        if (!cancelled) setAvailable(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [handle, handleValid, slug]);

  const canSubmit = handleValid && available !== false && displayName.trim().length > 0 && !busy;

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);

    // Persist the display name on the user profile (best-effort).
    if (displayName.trim() && displayName.trim() !== (user.displayName ?? "")) {
      await updateInboundProfile({ display_name: displayName.trim() });
    }

    // Paid pool with admin terms -> route through payment first.
    const hasFee = !!config?.entry_fee && config.entry_fee.cents > 0;
    const hasTerms = !!(config?.join_fee_terms_text && config.join_fee_terms_text.trim());
    if (hasFee && hasTerms) {
      setBusy(false);
      onPayment();
      return;
    }

    const res = await joinPool(slug, handle, displayName.trim());
    setBusy(false);
    if (res.ok) {
      onJoined(res.status);
    } else {
      setError(res.message);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ color: "#c7d0e6", fontSize: 14, margin: 0, textAlign: "center" }}>
        Set up your player profile to join.
      </p>
      {error && <p style={errorTextStyle}>{error}</p>}

      <label style={fieldStyle}>
        <span style={labelStyle}>Handle</span>
        <input
          type="text"
          placeholder="your_handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          style={inputStyle}
          autoComplete="off"
        />
        <span style={{ fontSize: 12, minHeight: 16, color: handleHintColour(handle, handleValid, available, checking) }}>
          {handleHint(handle, handleValid, available, checking)}
        </span>
      </label>

      <label style={fieldStyle}>
        <span style={labelStyle}>Display name</span>
        <input
          type="text"
          placeholder="How you'll show on the leaderboard"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          style={inputStyle}
        />
      </label>

      <div style={fieldStyle}>
        <span style={labelStyle}>Avatar (optional)</span>
        <AvatarUploader userId={user.id} onChange={() => undefined} />
      </div>

      <button type="button" onClick={() => void submit()} disabled={!canSubmit} style={primaryButtonStyle(primary)}>
        {busy ? "Joining…" : "Continue"}
      </button>
    </div>
  );
}

function handleHint(
  handle: string,
  valid: boolean,
  available: boolean | null,
  checking: boolean,
): string {
  if (!handle) return "2-32 letters, numbers or underscores.";
  if (!valid) return "Use 2-32 letters, numbers or underscores only.";
  if (checking) return "Checking availability…";
  if (available === false) return "That handle is taken in this pool.";
  if (available === true) return "Available.";
  return "";
}

function handleHintColour(
  handle: string,
  valid: boolean,
  available: boolean | null,
  checking: boolean,
): string {
  if (handle && valid && available === true && !checking) return "#34d399";
  if (handle && (!valid || available === false)) return "#f87171";
  return "#9aa6c2";
}

// --- Payment step -----------------------------------------------------

function PaymentStep({
  slug,
  primary,
  config,
  user,
  onJoined,
}: {
  slug: string;
  primary: string;
  config: PoolConfig;
  user: InboundUser | null;
  onJoined: (status: "active" | "pending") => void;
}): JSX.Element {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    const handle = user?.displayName ?? undefined;
    const res = await joinPool(slug, handle, user?.displayName ?? undefined);
    setBusy(false);
    if (res.ok) {
      onJoined(res.status);
    } else {
      setError(res.message);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontSize: 18, margin: 0, textAlign: "center" }}>How to pay &amp; terms</h2>
      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: "14px 16px",
          fontSize: 14,
          color: "#c7d0e6",
          whiteSpace: "pre-wrap",
          lineHeight: 1.5,
        }}
      >
        {config.join_fee_terms_text}
      </div>
      <p style={{ fontSize: 12, color: "#9aa6c2", margin: 0 }}>
        Tournamental does not handle this payment. The pool owner collects the
        entry fee and pays out any prizes directly.
      </p>

      {error && <p style={errorTextStyle}>{error}</p>}

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, color: "#e7ecf7" }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I have read and agree to the payment terms above.</span>
      </label>

      <button
        type="button"
        onClick={() => void confirm()}
        disabled={!agreed || busy}
        style={primaryButtonStyle(primary)}
      >
        {busy ? "Joining…" : "Join the pool"}
      </button>
    </div>
  );
}

// --- Done step --------------------------------------------------------

function DoneStep({ kind, primary }: { kind: DoneKind; primary: string }): JSX.Element {
  if (kind === "pending") {
    return (
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ fontSize: 20, margin: 0 }}>Request sent</h2>
        <p style={{ color: "#c7d0e6", fontSize: 14, margin: 0 }}>
          The pool owner will approve you. You&apos;ll be able to enter your picks once
          they do.
        </p>
      </div>
    );
  }

  const heading = kind === "already" ? "You're already in" : "You're in!";
  return (
    <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontSize: 22, margin: 0 }}>{heading}</h2>
      <a href="/world-cup-2026" style={primaryButtonStyle(primary)}>
        Enter Your Picks
      </a>
    </div>
  );
}

// --- Join helper ------------------------------------------------------

type JoinResult =
  | { ok: true; status: "active" | "pending" }
  | { ok: false; message: string };

async function joinPool(
  slug: string,
  handle: string | undefined,
  displayName: string | undefined,
): Promise<JoinResult> {
  try {
    const r = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/join`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ handle, display_name: displayName }),
    });
    const j = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      status?: "active" | "pending";
      already_member?: boolean;
      error?: string;
      message?: string;
    };
    if (r.ok && j.ok) {
      // A re-join (already_member) reports no explicit status; treat as active.
      return { ok: true, status: j.status === "pending" ? "pending" : "active" };
    }
    if (r.status === 401) {
      return { ok: false, message: "Your session expired. Refresh and sign in again." };
    }
    if (j.error === "handle_taken") {
      return { ok: false, message: j.message ?? "That handle is taken in this pool." };
    }
    return { ok: false, message: j.message ?? "Couldn't join the pool. Try again." };
  } catch {
    return { ok: false, message: "Network error. Check your connection and try again." };
  }
}

// --- Shared inline styles ---------------------------------------------

const errorTextStyle: React.CSSProperties = {
  color: "#f87171",
  fontSize: 13,
  margin: 0,
  textAlign: "center",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  color: "#e7ecf7",
  fontSize: 15,
  outline: "none",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#9aa6c2",
  letterSpacing: "0.04em",
};

function primaryButtonStyle(primary: string): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: "13px 16px",
    borderRadius: 10,
    border: "none",
    background: primary,
    color: "#0e0e12",
    fontSize: 15,
    fontWeight: 700,
    textAlign: "center",
    textDecoration: "none",
    cursor: "pointer",
  };
}

function ghostButtonStyle(primary: string): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 16px",
    borderRadius: 10,
    border: `1px solid ${primary}`,
    background: "transparent",
    color: primary,
    fontSize: 15,
    fontWeight: 600,
    textAlign: "center",
    cursor: "pointer",
  };
}

function Divider({ label }: { label: string }): JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
      <span style={{ fontSize: 11, color: "#6b7794", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
    </div>
  );
}
