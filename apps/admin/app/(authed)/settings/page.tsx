import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();

  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").filter(Boolean);
  const mailer = process.env.ADMIN_MAILER ?? "log";
  const apiBase = process.env.VTORN_API_BASE ?? "(unset — using mocks)";

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">Settings</h1>
        <p className="text-sm text-ink-200">
          Read-only mirror of the admin dashboard config. Edit by changing
          environment variables and restarting (super-admin only).
        </p>
      </header>

      <section className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 space-y-3 text-sm">
        <Row label="Logged in as" value={`${session.email} (${session.role})`} />
        <Row label="Admin email allowlist" value={`${adminEmails.length} addresses`} />
        <Row label="Mailer" value={mailer} />
        <Row label="API base" value={apiBase} />
        <Row label="Login enabled" value={adminEmails.length > 0 ? "yes" : "NO — login locked"} />
      </section>

      <section className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 text-xs text-ink-200">
        <strong className="text-ink-50">Why this is read-only.</strong> Editing
        the admin allowlist from inside the dashboard would create a privilege-
        escalation hazard (any super-admin could add a new super-admin without
        external review). Changes go through the deployment env config and are
        captured in the deploy log.
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-200">{label}</span>
      <span className="font-mono text-ink-50">{value}</span>
    </div>
  );
}
