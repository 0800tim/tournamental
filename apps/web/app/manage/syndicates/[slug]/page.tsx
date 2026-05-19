import type { Metadata } from "next";
import { ManageClient } from "./ManageClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage your syndicate · Tournamental",
  robots: "noindex",
};

export default function ManageSyndicatePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { phone?: string };
}): JSX.Element {
  return (
    <ManageClient
      slug={params.slug}
      prefilledPhone={searchParams.phone ?? ""}
    />
  );
}
