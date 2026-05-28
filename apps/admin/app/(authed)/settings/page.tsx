import { requireAuth, getAllowedUserIds, getAuthSmsBase } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAuth();

  const allowed = getAllowedUserIds();
  const phone = process.env.ADMIN_PHONE_E164 ?? "(unset)";
  const authBase = getAuthSmsBase();
  const authDbPath = process.env.ADMIN_AUTH_DB_PATH ?? "(auto-resolve from cwd)";
  const gameDbPath = process.env.ADMIN_GAME_DB_PATH ?? "(auto-resolve from cwd)";
  const apiBase = process.env.VTORN_API_BASE || "(unset — using direct sqlite + mocks)";
  const nodeEnv = process.env.NODE_ENV ?? "development";

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
        <Row label="Admin phone (OTP)" value={maskPhone(phone)} />
        <Row label="Allowed user ids" value={`${allowed.size}`} />
        <Row label="Login enabled" value={allowed.size > 0 ? "yes" : "NO, login locked"} />
        <Row label="Auth service" value={authBase} />
        <Row label="Game API base" value={apiBase} />
        <Row label="auth.db path" value={authDbPath} />
        <Row label="game.db path" value={gameDbPath} />
        <Row label="NODE_ENV" value={nodeEnv} />
      </section>

      <section className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 text-xs text-ink-200">
        <strong className="text-ink-50">Why this is read-only.</strong> Editing
        the admin allowlist from inside the dashboard would create a privilege-
        escalation hazard. Changes go through the deployment env config and are
        captured in the deploy log.
      </section>
    </div>
  );
}

function maskPhone(p: string): string {
  if (p.length < 6) return p;
  return `${p.slice(0, 3)}${"*".repeat(p.length - 7)}${p.slice(-4)}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-200 whitespace-nowrap">{label}</span>
      <span className="font-mono text-ink-50 text-right break-all">{value}</span>
    </div>
  );
}
