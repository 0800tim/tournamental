import type { Metadata } from "next";
import { AuthPopupClient } from "./AuthPopupClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · Tournamental",
  robots: { index: false, follow: false },
};

export default async function AuthPopupPage(
  props: {
    searchParams: Promise<{ pool?: string; from?: string }>;
  }
): Promise<JSX.Element> {
  const searchParams = await props.searchParams;
  return (
    <AuthPopupClient
      pool={searchParams.pool ?? null}
      from={searchParams.from ?? null}
    />
  );
}
