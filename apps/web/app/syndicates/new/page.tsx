/**
 * /syndicates/new, public syndicate signup.
 *
 * Server-component wrapper around the client form. Owns metadata
 * (SEO, social card) and renders the form as a child. The form is
 * the entire page body; success state is rendered inline (no separate
 * route) so the URL doesn't change between submission and confirmation
 *, keeps back-button behaviour sensible and lets us track funnel
 * completion via a single page-view event.
 */

import type { Metadata } from "next";

import { SyndicateForm } from "./SyndicateForm";

export const metadata: Metadata = {
  title: "Create a syndicate, Tournamental",
  description:
    "Start your own World Cup 2026 prediction pool with friends, family, or your office. Free to play, no app to install.",
  robots: { index: true, follow: true },
};

export const dynamic = "force-dynamic";

export default function NewSyndicatePage(): JSX.Element {
  return <SyndicateForm />;
}
