/**
 * /s/[guid]/join — the dedicated pool join flow.
 *
 * A focused, branded landing: the pool's logo + prize, and nothing but
 * the sign-in options (WhatsApp / email, plus NZ-AU SMS). After sign-in
 * the same surface flows into a quick onboarding (handle, name, avatar)
 * and, for paid pools, the admin's payment terms, then joins the pool.
 *
 * Deliberately renders WITHOUT the app shell/nav so the page is just the
 * invite. Resolution reuses the share-guid resolver so /s/<slug>/join,
 * /s/<share-guid>/join etc. all work and 404 cleanly.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolveShareGuid } from "@/lib/share/resolve-guid";
import { JoinFlowClient } from "@/components/join/JoinFlowClient";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly guid: string }>;
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const resolved = await resolveShareGuid((params.guid ?? "").toLowerCase().trim());
  const name = resolved.kind === "syndicate" ? resolved.syndicate.name : "a pool";
  return {
    title: `Join ${name} · Tournamental`,
    description: `Sign in to join ${name} and make your World Cup 2026 predictions.`,
    robots: { index: false, follow: false },
  };
}

export default async function JoinPage(props: PageProps): Promise<JSX.Element> {
  const params = await props.params;
  const resolved = await resolveShareGuid((params.guid ?? "").toLowerCase().trim());
  if (resolved.kind !== "syndicate") notFound();
  return <JoinFlowClient slug={resolved.syndicate.slug} initialName={resolved.syndicate.name} />;
}
