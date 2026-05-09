import { Api } from "@/lib/api";
import { requireAuth } from "@/lib/auth";
import { FlagsList } from "./FlagsList";

export const dynamic = "force-dynamic";

export default async function FeatureFlagsPage() {
  const session = await requireAuth();
  const data = await Api.featureFlags(session);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Feature flags</h1>
        <p className="text-sm text-ink-200">
          Toggle features per geo / cohort. Edits are audit-logged. Super-admin only.
        </p>
      </header>
      <FlagsList rows={data.rows} role={session.role} />
    </div>
  );
}
