/**
 * Tournamental auth page, phone → OTP → logged in.
 *
 * Server component shell that hosts the client-side <AuthForm/>.
 * The whole flow is intentionally one route with client-managed state
 * (rather than two redirects) so the user keeps the same tab and the
 * WebOTP API can autofill into the visible <input>.
 */

import { Suspense } from "react";
import AuthForm from "./AuthForm";
import TelegramLogin from "./TelegramLogin";
import "./auth.css";

export const metadata = {
  title: "Tournamental, Sign in",
  description: "Sign in with your phone number, we'll text you a 6-digit code.",
};

// Auth pages should not be cached.
export const dynamic = "force-dynamic";

export default function AuthPage() {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">Sign in to Tournamental</h1>
        <p className="auth-sub">
          We&apos;ll text you a 6-digit code. No password.
        </p>
        <Suspense fallback={<div className="auth-loading">Loading…</div>}>
          <AuthForm />
        </Suspense>
        <div className="auth-divider" aria-hidden="true">
          <span>or</span>
        </div>
        <Suspense fallback={<div className="auth-loading">Loading…</div>}>
          <TelegramLogin />
        </Suspense>
        {/* Pre-launch legal block (2026-05-13). The OTP delivery
            partners are named explicitly per the privacy review so the
            user knows where their phone or email is going before they
            hand it over. Same copy appears on the marketing
            /login.astro Telegram + phone blocks. */}
        <p className="auth-legal">
          By continuing, you agree to our{" "}
          <a href="https://tournamental.com/legal/terms">Terms</a> and{" "}
          <a href="https://tournamental.com/legal/privacy">Privacy Policy</a>.
          We send SMS, WhatsApp and email codes via Aiva SMS and Supabase.
          Standard message rates may apply.
        </p>
      </div>
    </main>
  );
}
