/**
 * /syndicates/new/success
 *
 * The primary flow renders the success card inline on /syndicates/new
 * to keep the funnel single-URL. This route exists as a graceful
 * fallback for sessions that lose state (e.g. a hard reload after
 * submitting). It reads `?slug=…` from the query string and renders
 * the same share card the form does on success.
 *
 * It does NOT re-verify the slug exists, the share URL is unguessable
 * enough on its own, and the goal is "user lands on a page that
 * matches what they expect to see", not auth.
 */

import type { Metadata } from "next";

import { SyndicateSuccessClient } from "./SyndicateSuccessClient";

export const metadata: Metadata = {
  title: "Syndicate created, Tournamental",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function NewSyndicateSuccessPage({
  searchParams,
}: {
  searchParams: { slug?: string };
}): JSX.Element {
  const slug = (searchParams.slug ?? "").toString();
  return <SyndicateSuccessClient slug={slug} />;
}
