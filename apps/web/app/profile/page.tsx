/**
 * /profile, Supabase-backed editable profile.
 *
 * The page itself is a server component shell; the editor + auth gating
 * live in <ProfilePage/> (client component) so the auth listener can
 * subscribe. The shell stays cheap to render on first paint.
 */

import { AppShell } from "@/components/shell";
import { ProfilePage } from "@/components/auth/ProfilePage";

export const metadata = {
  title: "Profile - Tournamental",
};

// /profile is user-specific.
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell title="Profile">
      <div className="vt-page-content">
        <ProfilePage />
      </div>
    </AppShell>
  );
}
