import type { Metadata } from "next";
import { AuthPopupClient } from "./AuthPopupClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · Tournamental",
  robots: { index: false, follow: false },
};

export default function AuthPopupPage({
  searchParams,
}: {
  searchParams: { pool?: string; from?: string };
}): JSX.Element {
  return (
    <AuthPopupClient
      pool={searchParams.pool ?? null}
      from={searchParams.from ?? null}
    />
  );
}
