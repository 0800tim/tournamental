/**
 * /broadcast: pick pools + a playbook (or custom markdown), preview
 * the rendered messages, and send (or dry-run) via WhatsApp / email.
 *
 * Server component. Loads the syndicate list and the available
 * playbook templates server-side, hands them to <BroadcastClient />
 * which owns the interaction state.
 */
import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { loadPlaybooks } from "@/lib/broadcast";
import { BroadcastClient } from "./BroadcastClient";

export const dynamic = "force-dynamic";

export default async function BroadcastPage(
  props: {
    searchParams: Promise<{ slug?: string | string[] }>;
  }
) {
  const searchParams = await props.searchParams;
  const session = await requireAuth();
  const [syndicates, playbooks] = await Promise.all([
    Api.syndicates(session, "", ""),
    loadPlaybooks(),
  ]);

  // Allow a deep link from the pool detail page: `/broadcast?slug=the-crate`
  // pre-selects that pool. Repeat the param to seed multiple.
  const preselect: string[] = [];
  if (Array.isArray(searchParams.slug)) preselect.push(...searchParams.slug);
  else if (typeof searchParams.slug === "string") preselect.push(searchParams.slug);

  // Pass only the fields the client needs; keeps the wire payload lean
  // and avoids leaking owner_email / owner_phone to the browser. The
  // server route looks those up on demand when the form is submitted.
  const pools = syndicates.rows.map((r) => {
    const ext = r as typeof r & {
      is_public?: boolean;
      owner_handle?: string | null;
      tier?: string;
    };
    return {
      slug: r.slug,
      name: r.name,
      members: r.members,
      isPublic: ext.is_public ?? false,
      ownerHandle: ext.owner_handle ?? null,
      tier: ext.tier ?? "free",
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-display font-semibold">Broadcast</h1>
        <p className="text-sm text-ink-200">
          Send a one-off message to selected pool owners via WhatsApp or
          email. Dry-run is on by default; the confirm step shows you
          exactly what will go out before anything sends.
        </p>
      </header>

      <BroadcastClient pools={pools} playbooks={playbooks} preselect={preselect} />
    </div>
  );
}
