/**
 * Background runner for the bulk-invite queue.
 *
 * Started lazily by the API route that creates a job (the runner runs
 * in any Node.js worker that touched the queue most recently). Loops
 * every ~250ms, atomically claims one queued recipient via
 * `claimNextRecipient`, dispatches the message through the auth-sms
 * /v1/internal/send-message endpoint, and writes the result back.
 *
 * Cluster safety: `claimNextRecipient` uses an atomic SQLite UPDATE,
 * so two workers can race without sending the same recipient twice.
 *
 * Throttle: stored per-job in `invite_jobs.throttle_ms` (default
 * 1000ms = 1 msg/sec, slow enough to stay under WhatsApp policy
 * radar for warm-list invites).
 */

import {
  claimNextRecipient,
  inviteDb,
  markRecipientSent,
  type InviteRecipientRow,
} from "./store";
import { renderInviteMessage } from "./parse-csv";

const TICK_MS = 250;

let _interval: NodeJS.Timeout | null = null;
let _running = false;

interface SendResult {
  whatsapp?: { status: "sent" | "failed" | "skipped"; error?: string };
  email?: { status: "sent" | "failed" | "skipped"; error?: string };
}

async function sendOne(
  recipient: InviteRecipientRow,
  job: { message_body: string; channels: string[]; syndicate_slug: string },
  ownerName: string,
  poolName: string,
): Promise<SendResult> {
  const url = process.env.INTERNAL_AUTH_SMS_URL ?? "https://auth.tournamental.com";
  const secret = process.env.INTERNAL_BROADCAST_SECRET;
  if (!secret || secret.length < 24) {
    return {
      whatsapp: { status: "failed", error: "INTERNAL_BROADCAST_SECRET unset" },
      email: { status: "failed", error: "INTERNAL_BROADCAST_SECRET unset" },
    };
  }

  const rendered = renderInviteMessage({
    template: job.message_body,
    firstName: recipient.first_name,
    poolName,
    ownerName,
    joinUrl: recipient.warm_url,
    maxChars: 1000,
  });

  const wantsWhatsapp = job.channels.includes("whatsapp") && !!recipient.phone_e164;
  const wantsEmail = job.channels.includes("email") && !!recipient.email;

  if (!wantsWhatsapp && !wantsEmail) {
    return { whatsapp: { status: "skipped", error: "no-channel-for-recipient" } };
  }

  const body = {
    body: rendered,
    ...(wantsWhatsapp ? { phone: recipient.phone_e164 } : {}),
    ...(wantsEmail ? { email: recipient.email, subject: `You're invited to ${poolName}` } : {}),
  };

  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/v1/internal/send-message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      // Don't block the runner on a single slow recipient.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return {
        whatsapp: wantsWhatsapp ? { status: "failed", error: `upstream-${res.status}` } : undefined,
        email: wantsEmail ? { status: "failed", error: `upstream-${res.status}` } : undefined,
      };
    }
    return (await res.json()) as SendResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return {
      whatsapp: wantsWhatsapp ? { status: "failed", error: msg } : undefined,
      email: wantsEmail ? { status: "failed", error: msg } : undefined,
    };
  }
}

async function tick(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const db = inviteDb();
    if (!db) return;

    const recipient = claimNextRecipient(db);
    if (!recipient) return;

    const job = db
      .prepare(
        `SELECT j.message_body, j.channels, j.syndicate_slug, j.syndicate_id,
                s.name AS pool_name, s.owner_handle AS owner_handle
         FROM invite_jobs j
         LEFT JOIN syndicates s ON s.id = j.syndicate_id
         WHERE j.id = ?`,
      )
      .get(recipient.job_id) as
      | {
          message_body: string;
          channels: string;
          syndicate_slug: string;
          syndicate_id: string;
          pool_name: string | null;
          owner_handle: string | null;
        }
      | undefined;
    if (!job) {
      markRecipientSent(db, recipient.id, {
        meta: { status: "failed", error: "job-not-found" },
      });
      return;
    }

    const jobView = {
      message_body: job.message_body,
      channels: JSON.parse(job.channels) as string[],
      syndicate_slug: job.syndicate_slug,
    };
    const result = await sendOne(
      recipient,
      jobView,
      job.owner_handle ?? "the pool admin",
      job.pool_name ?? "the pool",
    );
    markRecipientSent(db, recipient.id, result as Record<string, { status: string; error?: string }>);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[invite/runner] tick error:", err);
  } finally {
    _running = false;
  }
}

/** Start the runner if it isn't already. Idempotent. */
export function startInviteRunner(): void {
  if (_interval) return;
  _interval = setInterval(() => {
    void tick();
  }, TICK_MS);
  // eslint-disable-next-line no-console
  console.log("[invite/runner] started, tick=" + TICK_MS + "ms");
}

/** Stop the runner. Used in tests. */
export function stopInviteRunner(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
