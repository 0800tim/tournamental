/**
 * Owner notification for approval-gated pool join requests.
 *
 * When a pool is configured with `requires_approval=1` and a new user
 * hits the join endpoint, the membership row is inserted with
 * status='pending' and this helper fires a SendGrid email to the
 * pool owner with two single-use tokenised links:
 *
 *   Approve → /api/v1/syndicates/<slug>/join-requests/<userId>/approve?t=<token>
 *   Deny    → /api/v1/syndicates/<slug>/join-requests/<userId>/deny?t=<token>
 *
 * The token is an HMAC of `<syndicate_id>:<user_id>:<action>` using
 * the shared AUTH_JWT_SECRET so the approve/deny endpoints can verify
 * without DB lookup state. Tokens don't expire on their own — they're
 * single-use because the underlying status='pending' row can only be
 * flipped once (re-approving an already-active row is a no-op).
 *
 * Best-effort: any failure to send is swallowed and logged. The pool
 * owner can also see + approve pending requests from the manage
 * dashboard, so a stuck SendGrid never blocks the flow (Tim 2026-05-22).
 *
 * WhatsApp owner notification + reply 1/2 parsing is a separate piece
 * of work; this file is email-only for v1.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SyndicateRow } from "@/lib/syndicate/persistence";

interface NotifyArgs {
  pool: SyndicateRow;
  requester: {
    user_id: string;
    handle: string;
    display_name?: string | null;
  };
}

const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

const PLAY_HOST =
  process.env.NEXT_PUBLIC_PLAY_HOST ?? "https://play.tournamental.com";

/**
 * SEC-POOL-03 / SEC-WEB-04: approve/deny tokens used to be deterministic
 * HMACs over AUTH_JWT_SECRET with no `exp`. Two consequences:
 *
 *   - A leaked token never expired and a single secret rotation took
 *     out the entire OTP pathway alongside the approval flow.
 *   - The token format was identical across the lifetime of a pool
 *     so an attacker who saw one stale approve link could replay it
 *     forever.
 *
 * The new shape:
 *
 *   token = base64url(`${iat}.${mac}`)
 *
 * where `mac` is HMAC-SHA256(`${iat}:${syndicate_id}:${user_id}:${action}`)
 * keyed on a dedicated `APPROVAL_TOKEN_SECRET`. Verification rejects
 * tokens whose `iat` is older than 72 hours.
 *
 * The dedicated env var means the AUTH_JWT_SECRET can rotate without
 * invalidating any pending approve/deny link, and vice versa.
 */
const APPROVAL_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

function approvalSecret(): string | null {
  const s = process.env.APPROVAL_TOKEN_SECRET ?? "";
  return s ? s : null;
}

export function signApprovalToken(
  syndicate_id: string,
  user_id: string,
  action: "approve" | "deny",
): string {
  const secret = approvalSecret();
  if (!secret) {
    // Returning empty token disables approve/deny via link until the
    // env var is wired; the owner can still approve from the dashboard.
    console.warn(
      "[signApprovalToken] APPROVAL_TOKEN_SECRET not set; approve/deny email link disabled. " +
        "Owner can still approve from the dashboard.",
    );
    return "";
  }
  const iat = Date.now();
  const mac = createHmac("sha256", secret)
    .update(`${iat}:${syndicate_id}:${user_id}:${action}`)
    .digest("hex");
  return Buffer.from(`${iat}.${mac}`, "utf8").toString("base64url");
}

export function verifyApprovalToken(
  syndicate_id: string,
  user_id: string,
  action: "approve" | "deny",
  token: string,
): boolean {
  if (!token) return false;
  const secret = approvalSecret();
  if (!secret) return false;
  let raw: string;
  try {
    raw = Buffer.from(token, "base64url").toString("utf8");
  } catch {
    return false;
  }
  const dot = raw.indexOf(".");
  if (dot < 0) return false;
  const iat = Number.parseInt(raw.slice(0, dot), 10);
  const mac = raw.slice(dot + 1);
  if (!Number.isFinite(iat) || !mac) return false;
  if (Date.now() - iat > APPROVAL_TOKEN_TTL_MS) return false;
  const expected = createHmac("sha256", secret)
    .update(`${iat}:${syndicate_id}:${user_id}:${action}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(mac, "hex");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function notifyOwnerOfJoinRequest(args: NotifyArgs): Promise<void> {
  // Fire email + WhatsApp in parallel. Each channel is best-effort —
  // a failure in one doesn't block the other, and neither blocks the
  // join request itself (the caller already returned to the user).
  await Promise.all([
    sendEmailNotification(args).catch((e) =>
      console.error("[notifyOwnerOfJoinRequest] email error", e),
    ),
    sendWhatsAppNotification(args).catch((e) =>
      console.error("[notifyOwnerOfJoinRequest] whatsapp error", e),
    ),
  ]);
}

async function sendEmailNotification(args: NotifyArgs): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY ?? "";
  const fromEmail =
    process.env.SENDGRID_FROM_EMAIL ?? "login@tournamental.com";
  const fromName = process.env.SENDGRID_FROM_NAME ?? "Tournamental";

  if (!apiKey) {
    console.warn(
      "[notifyOwnerOfJoinRequest] SENDGRID_API_KEY not set; skipping email. " +
        "Owner can still approve from the dashboard.",
      { pool: args.pool.slug, requester: args.requester.handle },
    );
    return;
  }
  if (!args.pool.owner_email) {
    console.warn("[notifyOwnerOfJoinRequest] pool has no owner_email", {
      pool: args.pool.slug,
    });
    return;
  }

  const approveToken = signApprovalToken(args.pool.id, args.requester.user_id, "approve");
  const denyToken = signApprovalToken(args.pool.id, args.requester.user_id, "deny");
  const approveUrl = `${PLAY_HOST}/api/v1/syndicates/${encodeURIComponent(
    args.pool.slug,
  )}/join-requests/${encodeURIComponent(args.requester.user_id)}/approve?t=${approveToken}`;
  const denyUrl = `${PLAY_HOST}/api/v1/syndicates/${encodeURIComponent(
    args.pool.slug,
  )}/join-requests/${encodeURIComponent(args.requester.user_id)}/deny?t=${denyToken}`;
  const dashboardUrl = `${PLAY_HOST}/dashboard/syndicates/${encodeURIComponent(
    args.pool.slug,
  )}`;

  const requesterLabel =
    args.requester.display_name?.trim()
      ? `${args.requester.display_name.trim()} (@${args.requester.handle})`
      : `@${args.requester.handle}`;

  const subject = `${requesterLabel} wants to join ${args.pool.name}`;
  const text =
    `${requesterLabel} has requested to join your prediction pool ` +
    `"${args.pool.name}".\n\n` +
    `Approve: ${approveUrl}\n` +
    `Deny:    ${denyUrl}\n\n` +
    `Or open your dashboard to review all pending requests:\n` +
    `${dashboardUrl}\n\n` +
    `— Tournamental`;
  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:32px auto;color:#15151a">
  <p style="font-size:14px;color:#666;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 4px">JOIN REQUEST · ${escapeHtml(args.pool.name)}</p>
  <h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(requesterLabel)} wants to join your pool</h1>
  <p style="font-size:15px;line-height:1.5">Approve their request and they'll join the leaderboard immediately. Deny if you don't recognise them.</p>
  <p style="margin:24px 0">
    <a href="${approveUrl}" style="display:inline-block;padding:12px 22px;background:linear-gradient(180deg,#fcd34d,#f59e0b);color:#15151a;font-weight:800;border-radius:8px;text-decoration:none;margin-right:12px">Approve →</a>
    <a href="${denyUrl}" style="display:inline-block;padding:12px 22px;background:#fee2e2;color:#7f1d1d;font-weight:700;border-radius:8px;text-decoration:none">Deny</a>
  </p>
  <p style="font-size:13px;color:#666">Or <a href="${dashboardUrl}" style="color:#9a6a17">open the dashboard</a> to review all pending requests.</p>
  <p style="font-size:12px;color:#999;margin-top:32px">Sent because you administer ${escapeHtml(args.pool.name)} on Tournamental.</p>
</body></html>`;

  try {
    const res = await fetch(SENDGRID_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: args.pool.owner_email }] }],
        from: { email: fromEmail, name: fromName },
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[notifyOwnerOfJoinRequest] sendgrid non-2xx", {
        status: res.status,
        body: body.slice(0, 300),
      });
    }
  } catch (err) {
    console.error("[notifyOwnerOfJoinRequest] sendgrid transport error", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * WhatsApp notification via the Aiva gateway. We deliberately don't
 * embed approve/deny links inline here — the message just says "open
 * your dashboard" and links to /dashboard/syndicates/<slug> where the
 * owner reviews + approves. Keeping the WhatsApp body short avoids
 * the gateway truncating long URLs and removes the need for an
 * inbound "1"/"2" reply parser (Tim 2026-05-22).
 */
async function sendWhatsAppNotification(args: NotifyArgs): Promise<void> {
  const apiKey = process.env.AIVA_SMS_API_KEY ?? "";
  const sessionId = process.env.AIVA_WA_SESSION_ID ?? "";
  const baseUrl =
    process.env.AIVA_SMS_API_URL ?? process.env.AIVA_SMS_URL ?? "";

  if (!apiKey || !sessionId || !baseUrl) {
    // Dev environments typically don't have the gateway wired; skip
    // quietly so the join request still succeeds via email + dashboard.
    return;
  }
  if (!args.pool.owner_phone) {
    return;
  }

  const requesterLabel =
    args.requester.display_name?.trim()
      ? `${args.requester.display_name.trim()} (@${args.requester.handle})`
      : `@${args.requester.handle}`;
  const dashboardUrl = `${PLAY_HOST}/dashboard/syndicates/${encodeURIComponent(
    args.pool.slug,
  )}`;
  const body =
    `🎯 Tournamental: ${requesterLabel} wants to join your pool ` +
    `"${args.pool.name}".\n\n` +
    `Open your dashboard to approve or deny:\n${dashboardUrl}`;

  // The Aiva gateway expects E.164 without the leading "+". The
  // owner_phone is stored in E.164 form, so strip the plus here.
  const phone = args.pool.owner_phone.replace(/^\+/, "");
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/whatsapp/sessions/${encodeURIComponent(
    sessionId,
  )}/send`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ phone, message: body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[notifyOwnerOfJoinRequest] whatsapp non-2xx", {
        status: res.status,
        body: text.slice(0, 300),
      });
    }
  } catch (err) {
    console.error("[notifyOwnerOfJoinRequest] whatsapp transport error", err);
  }
}
