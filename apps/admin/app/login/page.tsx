import { isLoginEnabled } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; sent?: string; error?: string };
}) {
  const enabled = isLoginEnabled();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-ink-800 ring-1 ring-ink-700 rounded-lg p-8">
        <div className="mb-6">
          <div className="text-xl font-display font-semibold">Tournamental Admin</div>
          <div className="text-xs uppercase tracking-wider text-accent-400 mb-3">
            Sign in
          </div>
          <p className="text-sm text-ink-200">
            Enter your admin email. We'll send you a one-time sign-in link valid
            for 15 minutes.
          </p>
        </div>

        {!enabled && (
          <div
            role="alert"
            className="bg-danger-500/20 border border-danger-500/40 text-danger-500 text-sm rounded p-3 mb-4"
          >
            Login is disabled — <code className="font-mono">ADMIN_EMAILS</code> is
            empty. Set it in <code className="font-mono">.env</code> to enable.
          </div>
        )}

        {searchParams.sent === "1" && (
          <div
            role="status"
            className="bg-emerald-500/20 border border-emerald-500/40 text-emerald-500 text-sm rounded p-3 mb-4"
          >
            If that email is allowlisted, a sign-in link is on its way.
          </div>
        )}

        {searchParams.error && (
          <div
            role="alert"
            className="bg-danger-500/20 border border-danger-500/40 text-danger-500 text-sm rounded p-3 mb-4"
          >
            {searchParams.error === "expired"
              ? "That link expired. Request a new one."
              : searchParams.error === "invalid"
                ? "Invalid sign-in link."
                : "Sign-in failed."}
          </div>
        )}

        <LoginForm next={searchParams.next ?? "/"} disabled={!enabled} />

        <div className="mt-6 text-xs text-ink-500">
          Magic-link auth (no passwords). Sessions last 8 hours, then re-auth.
        </div>
      </div>
    </div>
  );
}
