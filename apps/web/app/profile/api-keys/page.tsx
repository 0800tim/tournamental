/**
 * /profile/api-keys , self-service personal API key flow.
 *
 * Server component shell , the editor + mint + revoke buttons live in
 * <ApiKeysPage/> (client component) so it can subscribe to the
 * Supabase auth listener and fetch the keys list against the
 * game-service. The shell stays trivial.
 *
 * Cache: user-specific. Force dynamic, every render is per-session.
 */

import { AppShell } from "@/components/shell";
import { ApiKeysPage } from "@/components/auth/ApiKeysPage";

export const metadata = {
  title: "Personal API keys , Tournamental",
};

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <AppShell title="API keys">
      <div className="vt-page-content">
        <ApiKeysPage />
      </div>
    </AppShell>
  );
}
