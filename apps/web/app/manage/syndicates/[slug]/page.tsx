import type { Metadata } from "next";
import { ManageClient } from "./ManageClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Manage your syndicate · Tournamental",
  robots: "noindex",
};

export default async function ManageSyndicatePage(
  props: {
    params: Promise<{ slug: string }>;
    searchParams: Promise<{ phone?: string }>;
  }
): Promise<JSX.Element> {
  const searchParams = await props.searchParams;
  const params = await props.params;
  return (
    <ManageClient
      slug={params.slug}
      prefilledPhone={searchParams.phone ?? ""}
    />
  );
}
