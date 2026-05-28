import { isLoginEnabled } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string; error?: string };
}) {
  const enabled = isLoginEnabled();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-ink-800 ring-1 ring-ink-700 rounded-lg p-8">
        <div className="mb-6">
          <div className="text-xl font-display font-semibold">Tournamental Admin</div>
          <div className="text-xs uppercase tracking-wider text-accent-400 mb-3">
            Step-up sign in
          </div>
          <p className="text-sm text-ink-200">
            You're inside the Cloudflare perimeter. Confirm it's you with a
            one-time WhatsApp code.
          </p>
        </div>

        {!enabled && (
          <div
            role="alert"
            className="bg-danger-500/20 border border-danger-500/40 text-danger-500 text-sm rounded p-3 mb-4"
          >
            Login is disabled. Set{" "}
            <code className="font-mono">ADMIN_PHONE_E164</code> and{" "}
            <code className="font-mono">ADMIN_ALLOWED_USER_IDS</code> in the
            admin app environment.
          </div>
        )}

        {searchParams.error && (
          <div
            role="alert"
            className="bg-danger-500/20 border border-danger-500/40 text-danger-500 text-sm rounded p-3 mb-4"
          >
            {searchParams.error === "expired"
              ? "Your session expired. Sign in again."
              : "Sign-in failed."}
          </div>
        )}

        <LoginForm next={searchParams.next ?? "/"} disabled={!enabled} />

        <div className="mt-6 text-xs text-ink-500">
          WhatsApp OTP. Sessions last 24 hours, then a fresh code is required.
        </div>
      </div>
    </div>
  );
}
