/**
 * /profile, Supabase-backed editable profile.
 *
 * The page itself is a server component shell; the editor + auth gating
 * live in <ProfilePage/> (client component) so the auth listener can
 * subscribe. The shell stays cheap to render on first paint.
 */

import { getTranslations } from "next-intl/server";

import { AppShell } from "@/components/shell";
import { ProfilePage } from "@/components/auth/ProfilePage";

export const metadata = {
  title: "Profile - Tournamental",
};

// /profile is user-specific.
export const dynamic = "force-dynamic";

async function safeT(key: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations();
    const out = t(key);
    return out === key ? fallback : out;
  } catch {
    return fallback;
  }
}

export default async function Page() {
  const title = await safeT("profile.page_title", "Profile");
  return (
    <AppShell title={title}>
      <div className="vt-page-content">
        <ProfilePage />
      </div>
    </AppShell>
  );
}
