/* eslint-disable react/no-unescaped-entities */
/**
 * /embed/preview — visual QA harness for the embed widget.
 *
 * Loads the widget against any slug you pass via ?slug=<slug>, with
 * sensible defaults so a partner can sanity-check what their syndicate
 * looks like before pasting the snippet on their own site. Also
 * shows the snippet itself so they can copy it.
 */

import type { Metadata } from "next";

import { EmbedPreview } from "./EmbedPreview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Embed widget preview · Tournamental",
  description: "Preview how the <tournamental-syndicate> embed widget looks before adding it to your site.",
  robots: { index: false, follow: false },
};

export default function EmbedPreviewPage({
  searchParams,
}: {
  searchParams?: { slug?: string };
}): JSX.Element {
  const slug = (searchParams?.slug ?? "").toLowerCase().trim();
  return <EmbedPreview slug={slug} />;
}
