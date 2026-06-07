/**
 * /bots/keys, self-service API key issuance for the Open Bot Arena.
 *
 * The page is a server component so we can resolve the session via
 * `getSessionFromRequest` against the inbound cookie and gate the
 * form behind a magic-link sign-in. Unauthenticated visitors see the
 * sign-in prompt instead of the form; the form itself is a small
 * client component that posts to /api/v1/bots/keys.
 *
 * Refs: docs/superpowers/specs/2026-06-07-bot-arena-design.md §6.3
 * Refs: docs/superpowers/plans/2026-06-07-bot-arena-phase-1.md Task 17
 */

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { AppShell } from "@/components/shell";
import { getSessionFromRequest } from "@/lib/auth/session";
import { loadUserContact } from "@/lib/auth/contact-lookup";

import { IssueKeyForm } from "./IssueKeyForm";

import "./keys.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Issue API Key · Tournamental Bot Arena",
  description:
    "Self-service API key issuance for the Tournamental Bot SDK. Sign in, name your key, copy the secret. Free, instant, revocable.",
  robots: { index: false, follow: false },
};

export default async function BotKeysPage(): Promise<JSX.Element> {
  const reqHeaders = await headers();
  const reqLike = {
    headers: {
      get: (n: string) => reqHeaders.get(n),
    },
  };
  const session = await getSessionFromRequest(reqLike);
  const contact = session ? loadUserContact(session.userId) : null;
  const email = contact?.email ?? null;

  return (
    <AppShell title="Bot API Keys">
      <main className="vt-keys">
        <article className="vt-keys-article">
          <header className="vt-keys-header">
            <p className="vt-keys-eyebrow">Open Bot Arena</p>
            <h1 className="vt-keys-title">Bot API keys</h1>
            <p className="vt-keys-lede">
              Issue a key, name it, copy the secret. Use it in the{" "}
              <Link href="/bots/sdk">Tournamental Bot SDK</Link> as
              <code>TOURNAMENTAL_API_KEY</code>. Default quota is 1,000
              bots and 100,000 picks per hour; academic emails (.edu,
              .ac.uk, .ac.nz, .edu.au, .ac.za) ship with 10x quota out
              of the box.
            </p>
          </header>

          {session ? (
            <>
              {email ? (
                <p className="vt-keys-signedin">
                  Signed in as <strong>{email}</strong>. Issued keys
                  bind to this email.
                </p>
              ) : (
                <p className="vt-keys-signedin">
                  Signed in. Add a verified email to your{" "}
                  <Link href="/profile">profile</Link> so issued keys
                  carry your contact details for quota bumps and
                  abuse reports.
                </p>
              )}
              <IssueKeyForm />
              <section className="vt-keys-aside">
                <h2>Need a higher quota?</h2>
                <p>
                  Email{" "}
                  <a href="mailto:info@tournamental.com">
                    info@tournamental.com
                  </a>{" "}
                  from your university or company address. Quota
                  lifts are free and same-day for credible asks.
                </p>
                <h2>Lost a key?</h2>
                <p>
                  Issue a new one and email{" "}
                  <a href="mailto:info@tournamental.com">
                    info@tournamental.com
                  </a>{" "}
                  the label of the old key so we can revoke it. The
                  Bot SDK respects revocations on the next call.
                </p>
              </section>
            </>
          ) : (
            <section className="vt-keys-gate" aria-labelledby="vt-keys-gate-h">
              <h2 id="vt-keys-gate-h">Sign in to issue a key</h2>
              <p>
                Tournamental uses a passwordless sign-in. Enter your
                email on the sign-in page, click the magic link we send
                you, and you&apos;ll land back here ready to issue a
                key.
              </p>
              <Link
                className="vt-keys-cta vt-keys-cta--primary"
                href={`/login?next=${encodeURIComponent("/bots/keys")}`}
              >
                Sign in to continue
              </Link>
              <p className="vt-keys-gate-foot">
                Just here to read the docs? Head to{" "}
                <Link href="/bots/sdk">the Bot SDK overview</Link>.
                No account needed.
              </p>
            </section>
          )}
        </article>
      </main>
    </AppShell>
  );
}
