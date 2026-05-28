/**
 * POST /api/admin/broadcast
 *
 * Send (or dry-run) a one-off broadcast message to a set of syndicate
 * owners. The admin operator picks pools, picks a playbook template
 * (or writes a custom markdown body), and chooses one or both delivery
 * channels (whatsapp + email).
 *
 * Body shape:
 *   {
 *     slugs:       string[]                        // 1..50 pool slugs
 *     templateId?: string                          // playbook id from data/playbooks
 *     customBody?: string                          // bypasses templateId
 *     channels:    ('whatsapp' | 'email')[]
 *     dryRun:      boolean
 *   }
 *
 * Behaviour:
 *   - Loads each syndicate via `lib/live.ts::liveSyndicate(slug)` to
 *     pull owner_email + owner_phone.
 *   - Renders the message per recipient with `{{pool_name}}`,
 *     `{{owner_handle}}`, `{{tournament}}`, `{{member_count}}`.
 *   - dryRun=true (default): returns the rendered messages, sends nothing.
 *   - dryRun=false: would push each rendered message through
 *     `${ADMIN_AUTH_SMS_BASE_URL}/v1/auth/send-broadcast` (WhatsApp) and
 *     a SendGrid-backed email helper, BUT:
 *
 *       Limitation as of 2026-05: auth-sms exposes no broadcast or
 *       generic "send message" endpoint. The only public surface is
 *       `/v1/auth/request` which mints an OTP and bakes it into the
 *       body, which is wrong for marketing-style sends. SendGrid is
 *       similarly only wired through `/v1/auth/email-otp`. Until an
 *       internal broadcast endpoint lands on auth-sms (tracked in
 *       IDEAS.md), this route returns `not_implemented_yet` per
 *       (slug, channel) for live sends while keeping dry-run fully
 *       functional. Audit entries are still written so the operator
 *       intent is recorded.
 *
 *   - Writes one `writeAudit` entry per (recipient, dryRun) pair.
 *   - Rate-limited: 5 broadcast requests per minute per admin userId.
 */
import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { Api } from "@/lib/api";
import {
  loadPlaybooks,
  renderForRecipient,
  type BroadcastChannel,
  type BroadcastRecipient,
} from "@/lib/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory token bucket: 5 broadcast POSTs per rolling minute per
// admin user id. Module-scoped; persists across requests inside the
// Next.js worker process (good enough for a single-operator dashboard).
const RL_WINDOW_MS = 60_000;
const RL_LIMIT = 5;
const rateLimitState = new Map<string, number[]>();

function rateLimit(userId: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const bucket = rateLimitState.get(userId) ?? [];
  const trimmed = bucket.filter((t) => now - t < RL_WINDOW_MS);
  if (trimmed.length >= RL_LIMIT) {
    const retryAfter = Math.ceil((RL_WINDOW_MS - (now - trimmed[0])) / 1000);
    rateLimitState.set(userId, trimmed);
    return { ok: false, retryAfter };
  }
  trimmed.push(now);
  rateLimitState.set(userId, trimmed);
  return { ok: true };
}

interface BroadcastBody {
  slugs?: unknown;
  templateId?: unknown;
  customBody?: unknown;
  channels?: unknown;
  dryRun?: unknown;
}

function parseChannels(v: unknown): BroadcastChannel[] {
  if (!Array.isArray(v)) return [];
  const out: BroadcastChannel[] = [];
  for (const x of v) {
    if (x === "whatsapp" || x === "email") out.push(x);
  }
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  // Broadcast is super-admin only for now. The matrix in perms.ts
  // doesn't yet have a dedicated "broadcast.send" permission so we
  // gate by role directly here; promote to a permission key once
  // mod-tier broadcasting is on the roadmap.
  if (session.role !== "super-admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rl = rateLimit(session.userId);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSeconds: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: BroadcastBody;
  try {
    body = (await req.json()) as BroadcastBody;
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const slugs = Array.isArray(body.slugs)
    ? (body.slugs.filter((s): s is string => typeof s === "string" && s.length > 0))
    : [];
  if (slugs.length === 0) {
    return NextResponse.json({ error: "no_slugs" }, { status: 400 });
  }
  if (slugs.length > 50) {
    return NextResponse.json({ error: "too_many_slugs" }, { status: 400 });
  }

  const channels = parseChannels(body.channels);
  if (channels.length === 0) {
    return NextResponse.json({ error: "no_channels" }, { status: 400 });
  }

  const dryRun = body.dryRun !== false; // default ON

  // Resolve the message body: custom wins if provided, otherwise look
  // up the template by id.
  let messageBody: string;
  let templateLabel: string;
  if (typeof body.customBody === "string" && body.customBody.trim().length > 0) {
    messageBody = body.customBody;
    templateLabel = "custom";
  } else if (typeof body.templateId === "string" && body.templateId.length > 0) {
    const playbooks = await loadPlaybooks();
    const tpl = playbooks.find((p) => p.id === body.templateId);
    if (!tpl) {
      return NextResponse.json({ error: "template_not_found" }, { status: 400 });
    }
    messageBody = tpl.body;
    templateLabel = `playbook:${tpl.id}`;
  } else {
    return NextResponse.json({ error: "no_body" }, { status: 400 });
  }

  // Look up each pool. Build BroadcastRecipient[] keyed by slug. We
  // don't fail the whole call when one pool is missing: we record
  // it and continue.
  const recipients: BroadcastRecipient[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const s = await Api.syndicate(session, slug);
    if (!s) {
      missing.push(slug);
      continue;
    }
    // Live readers surface owner_email + owner_phone. Mock fallbacks
    // don't; we coerce defensively to satisfy the type.
    const owner = s as typeof s & {
      owner_email?: string | null;
      owner_phone?: string | null;
      owner_handle?: string | null;
      tournament_id?: string | null;
    };
    recipients.push({
      slug: s.slug,
      poolName: s.name,
      ownerHandle: owner.owner_handle ?? "there",
      ownerEmail: owner.owner_email ?? null,
      ownerPhone: owner.owner_phone ?? null,
      tournament: owner.tournament_id ?? "your tournament",
      memberCount: s.members,
    });
  }

  // Render all messages.
  const rendered = recipients.map((r) =>
    renderForRecipient({ body: messageBody, recipient: r, channels }),
  );

  if (dryRun) {
    // One audit entry per recipient, marked dry-run.
    for (const r of rendered) {
      await writeAudit(session, {
        action: "broadcast.dry-run",
        target: `syndicate:${r.slug}`,
        after: {
          template: templateLabel,
          channels: r.channels,
          skipped: r.skippedChannels,
        },
      });
    }
    return NextResponse.json({
      dryRun: true,
      count: rendered.length,
      messages: rendered,
      missing,
    });
  }

  // LIVE PATH (see header docblock for the limitation). We still
  // audit per recipient so the operator's intent is logged.
  const results: {
    slug: string;
    channel: BroadcastChannel;
    status: "not_implemented_yet" | "skipped";
    reason?: string;
  }[] = [];
  for (const r of rendered) {
    for (const skipped of r.skippedChannels) {
      results.push({
        slug: r.slug,
        channel: skipped.channel,
        status: "skipped",
        reason: skipped.reason,
      });
    }
    for (const c of r.channels) {
      results.push({
        slug: r.slug,
        channel: c,
        status: "not_implemented_yet",
        reason: "auth-sms has no broadcast endpoint yet",
      });
    }
    await writeAudit(session, {
      action: "broadcast.send",
      target: `syndicate:${r.slug}`,
      after: {
        template: templateLabel,
        channels: r.channels,
        skipped: r.skippedChannels,
        delivery: "not_implemented_yet",
      },
    });
  }

  return NextResponse.json({
    dryRun: false,
    count: rendered.length,
    results,
    missing,
    notice:
      "Live send path is not implemented: auth-sms has no broadcast endpoint. Dry-run works fully; live sends are no-ops and audited as not_implemented_yet.",
  });
}
