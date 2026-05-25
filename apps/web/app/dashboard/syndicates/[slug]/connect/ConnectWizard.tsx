"use client";

/* eslint-disable react/no-unescaped-entities */
/**
 * Premium-upgrade wizard. Three steps, with the third (tier-flip
 * detection) polling the owner endpoint every 5s after the user
 * tells us they finished checkout. The polling stops as soon as the
 * tier flips to "premium" or after 5 minutes (a normal HL workflow
 * completes inside ~30s; longer than 5 minutes means something is
 * stuck and the operator should look at HL).
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { useUser } from "@/lib/auth/useUser";

interface OwnerSyndicate {
  readonly slug: string;
  readonly name: string;
  readonly tier: "free" | "premium" | "past_due";
  readonly hl_location_id: string | null;
  readonly hl_premium_since: number | null;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "unauth" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "ready"; syndicate: OwnerSyndicate; awaitingPoll: boolean };

const HL_CHECKOUT_URL =
  process.env.NEXT_PUBLIC_HL_CHECKOUT_URL ??
  "https://tournamental.com/syndicates#pricing";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function ConnectWizard({ slug }: { slug: string }): JSX.Element {
  const auth = useUser();
  const [state, setState] = useState<ViewState>({ kind: "loading" });

  // Initial load.
  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user) {
      setState({ kind: "unauth" });
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await fetchOwner(slug);
      if (cancelled) return;
      if (result.kind === "ok") {
        setState({ kind: "ready", syndicate: result.syndicate, awaitingPoll: false });
      } else {
        setState({ kind: result.kind });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.loading, auth.user?.id, slug]);

  // Polling loop when the user has clicked "I finished checkout".
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (!state.awaitingPoll) return;
    if (state.syndicate.tier === "premium") return;

    let cancelled = false;
    const startedAt = Date.now();
    const tick = async (): Promise<void> => {
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        // Stop polling; the operator should look at HL.
        if (!cancelled) {
          setState((s) =>
            s.kind === "ready" ? { ...s, awaitingPoll: false } : s,
          );
        }
        return;
      }
      const result = await fetchOwner(slug);
      if (cancelled) return;
      if (result.kind === "ok") {
        setState({ kind: "ready", syndicate: result.syndicate, awaitingPoll: true });
        if (result.syndicate.tier === "premium") return;
      }
      window.setTimeout(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
    };
  }, [state, slug]);

  if (state.kind === "loading") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Upgrade</p>
          <h1 className="vt-dash-title">Loading…</h1>
        </header>
      </main>
    );
  }

  if (state.kind === "unauth") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Upgrade</p>
          <h1 className="vt-dash-title">Sign in to upgrade.</h1>
          <div className="vt-dash-cta-row">
            <a href="/?sign-in=1" className="vt-dash-btn vt-dash-btn-primary">
              Sign in
            </a>
          </div>
        </header>
      </main>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Upgrade</p>
          <h1 className="vt-dash-title">You don't own this syndicate.</h1>
          <div className="vt-dash-cta-row">
            <Link href="/dashboard/syndicates" className="vt-dash-btn vt-dash-btn-ghost">
              ← Your syndicates
            </Link>
          </div>
        </header>
      </main>
    );
  }

  if (state.kind === "not_found") {
    return (
      <main className="vt-dash">
        <header className="vt-dash-hero">
          <p className="vt-dash-eyebrow">Upgrade</p>
          <h1 className="vt-dash-title">Syndicate not found.</h1>
        </header>
      </main>
    );
  }

  const s = state.syndicate;
  const isPremium = s.tier === "premium";

  return (
    <main className="vt-dash">
      <header className="vt-dash-hero">
        <Link href={`/dashboard/syndicates/${s.slug}`} className="vt-dash-link">
          ← Back to manage syndicate
        </Link>
        <p className="vt-dash-eyebrow">Upgrade</p>
        <h1 className="vt-dash-title">Upgrade {s.name} to Premium</h1>
        <p className="vt-dash-sub">
          Premium is $97/month + usage, delivered by{" "}
          <a
            href="https://tournamental.com/partners/growth-spurt"
            target="_blank"
            rel="noreferrer"
            className="vt-dash-link"
          >
            Growth Spurt
          </a>
          . You get a dedicated HighLevel CRM sub-account, paid-entry handling via Stripe,
          SMS / WhatsApp / email at scale, subdomain hosting, and your own brand on every
          surface.
        </p>
      </header>

      {isPremium ? (
        <section className="vt-dash-row">
          <div className="vt-dash-row-head">
            <div>
              <h2 className="vt-dash-row-name">✓ Premium active</h2>
              <p className="vt-dash-row-meta">
                Your HighLevel sub-account is provisioned. Check your email for the login.
              </p>
            </div>
          </div>
          <div className="vt-dash-row-actions">
            {s.hl_location_id && (
              <a
                href={`https://app.gohighlevel.com/location/${s.hl_location_id}`}
                target="_blank"
                rel="noreferrer"
                className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
              >
                Open my CRM in HighLevel →
              </a>
            )}
            <Link
              href={`/dashboard/syndicates/${s.slug}`}
              className="vt-dash-btn vt-dash-btn-ghost vt-dash-btn-sm"
            >
              ← Back to manage
            </Link>
          </div>
        </section>
      ) : (
        <ol className="vt-connect-steps">
          <li className="vt-connect-step" data-state={state.awaitingPoll ? "done" : "current"}>
            <div className="vt-connect-step-head">
              <span className="vt-connect-step-n">1</span>
              <h2 className="vt-connect-step-title">Complete checkout</h2>
            </div>
            <p className="vt-connect-step-body">
              We use HighLevel's hosted Stripe Checkout for the $97/month subscription.
              Your card is charged by Stripe, funds settle to Growth Spurt's account; Tournamental
              never sees the money or your card details.
            </p>
            {!state.awaitingPoll && (
              <div className="vt-dash-cta-row">
                <a
                  href={HL_CHECKOUT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="vt-dash-btn vt-dash-btn-primary vt-dash-btn-sm"
                  onClick={() => {
                    // Optimistically advance to step 2 so the user can poll
                    // once they finish in the new tab.
                    window.setTimeout(() => {
                      setState((cur) =>
                        cur.kind === "ready"
                          ? { ...cur, awaitingPoll: true }
                          : cur,
                      );
                    }, 800);
                  }}
                >
                  Open checkout →
                </a>
              </div>
            )}
            {state.awaitingPoll && (
              <p className="vt-connect-step-note">
                ✓ Checkout opened. Continue in the other tab; we'll wait here.
              </p>
            )}
          </li>

          <li
            className="vt-connect-step"
            data-state={
              isPremium ? "done" : state.awaitingPoll ? "current" : "pending"
            }
          >
            <div className="vt-connect-step-head">
              <span className="vt-connect-step-n">2</span>
              <h2 className="vt-connect-step-title">We provision your CRM</h2>
            </div>
            <p className="vt-connect-step-body">
              When Stripe confirms the payment, a HighLevel workflow creates your CRM
              sub-account, configures the Tournamental-style workflows (welcome email,
              leaderboard digest, matchday alerts), and tags this syndicate as premium on
              our side. Takes about a minute.
            </p>
            {state.awaitingPoll && !isPremium && (
              <div className="vt-connect-poll">
                <div className="vt-connect-spinner" aria-hidden="true" />
                <span>Waiting for premium activation…</span>
              </div>
            )}
          </li>

          <li
            className="vt-connect-step"
            data-state={isPremium ? "done" : "pending"}
          >
            <div className="vt-connect-step-head">
              <span className="vt-connect-step-n">3</span>
              <h2 className="vt-connect-step-title">Check email for CRM login</h2>
            </div>
            <p className="vt-connect-step-body">
              Growth Spurt sends your HighLevel login to the email on this syndicate. From there
              you can send broadcasts, edit workflows, watch leaderboard climbs in real
              time, and onboard sponsors.
            </p>
          </li>
        </ol>
      )}

      <footer className="vt-dash-foot">
        <p className="vt-dash-sub">
          Questions? Growth Spurt's team handles premium onboarding directly — they'll get in
          touch within a business day of your first payment. The Tournamental side
          (this dashboard, your embed widget, your public landing) keeps working
          unchanged through the upgrade.
        </p>
      </footer>
    </main>
  );
}

async function fetchOwner(
  slug: string,
): Promise<
  | { kind: "ok"; syndicate: OwnerSyndicate }
  | { kind: "unauth" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
> {
  try {
    const r = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/owner`, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (r.status === 401) return { kind: "unauth" };
    if (r.status === 403) return { kind: "forbidden" };
    if (r.status === 404) return { kind: "not_found" };
    if (!r.ok) return { kind: "not_found" };
    const body = (await r.json()) as { syndicate?: OwnerSyndicate };
    if (!body.syndicate) return { kind: "not_found" };
    return { kind: "ok", syndicate: body.syndicate };
  } catch {
    return { kind: "not_found" };
  }
}
