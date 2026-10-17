/**
 * POST /api/v1/register-interest
 *
 * Register-interest signup for the upcoming tournament (RWC 2027 first).
 * Lives on play.tournamental.com (the hub). Stores a durable row in
 * game.db (register_interest) and mirrors the contact into HighLevel
 * tagged for the tournament. Returns the person's invite code so the
 * thank-you state can show their personal link.
 *
 * Abuse controls: honeypot field, per-IP rate limit, strict field
 * lengths, referral code validated against existing codes. Mutating
 * /api/v1 routes are also Origin-checked in middleware (SEC-WEB-01).
 *
 * No message is sent by this route. HighLevel workflows own follow-up.
 * Cache policy: write surface, `Cache-Control: no-store`.
 */

import type { NextRequest } from "next/server";

import { checkRateLimit, clientIp } from "@/lib/rate-limit/in-memory";
import {
  inviteCodeExists,
  markGhl,
  referralCount,
  upsertRegisterInterest,
} from "@/lib/register-interest/store";
import { pushRegisterInterestToGhl } from "@/lib/register-interest/ghl";
import { upcomingTournament } from "@/lib/tournaments/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/** A real submission is a few hundred bytes. Anything bigger is noise
 *  and would otherwise be parsed in full (review 2026-10-17, RI-04). */
const MAX_BODY_BYTES = 8 * 1024;

/** Where on the hub the form was submitted from. A path, nothing else. */
const SOURCE_PATH_RE = /^\/[A-Za-z0-9/_.-]{0,119}$/;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;
}

function normalisePhone(p: string | null): string | null {
  if (!p) return null;
  const digits = p.replace(/[^\d+]/g, "");
  if (!/^\+?\d{8,15}$/.test(digits)) return null;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function inviteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_INVITE_BASE_URL ||
    process.env.NEXT_PUBLIC_PLAY_ORIGIN ||
    "https://play.tournamental.com"
  ).replace(/\/+$/, "");
}

export async function POST(req: NextRequest) {
  const tournament = upcomingTournament();
  if (!tournament) {
    return json({ ok: false, error: "no_upcoming_tournament" }, 409);
  }

  const ip = clientIp(req);
  const rl = checkRateLimit(`register-interest:${ip}`, 8, 10 * 60 * 1000);
  if (!rl.ok) {
    return Response.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: {
          ...NO_STORE,
          "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)),
        },
      },
    );
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: "body_too_large" }, 413);
  }
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ ok: false, error: "body_too_large" }, 413);
    }
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  // Honeypot: real users never fill `website`. Bots do. Pretend success.
  if (str(body.website, 10)) {
    return json({ ok: true, invite_code: "", invite_url: "", referrals: 0 });
  }

  const email = (str(body.email, 200) ?? "").toLowerCase();
  if (!validEmail(email)) {
    return json({ ok: false, error: "email_invalid" }, 400);
  }
  const firstName = str(body.first_name, 80);
  // Exactly two letters (ISO 3166-1 alpha-2, as CF-IPCountry sends it).
  // Validate before trimming: slicing "IRL" to "IR" would file Ireland
  // under Iran (review 2026-10-17, RI-09).
  const countryRaw = str(body.country, 8);
  const country =
    countryRaw && /^[A-Za-z]{2}$/.test(countryRaw) ? countryRaw.toUpperCase() : null;
  const phone = normalisePhone(str(body.phone, 32));
  if (str(body.phone, 32) && !phone) {
    return json({ ok: false, error: "phone_invalid" }, 400);
  }
  const consent = body.consent === true || body.consent === "yes";
  if (!consent) {
    return json({ ok: false, error: "consent_required" }, 400);
  }
  const refRaw = str(body.ref, 16);
  const ref =
    refRaw && /^[a-z0-9]{4,16}$/.test(refRaw) && inviteCodeExists(refRaw)
      ? refRaw
      : null;

  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const sourcePathRaw = str(body.source_path, 120);
  const sourcePath =
    sourcePathRaw && SOURCE_PATH_RE.test(sourcePathRaw) ? sourcePathRaw : null;

  let result;
  try {
    result = upsertRegisterInterest({
      tournament_id: tournament.id,
      email,
      first_name: firstName,
      country,
      phone,
      consent,
      source_host: host || null,
      source_path: sourcePath,
      referred_by_code: ref,
      ip,
      user_agent: req.headers.get("user-agent"),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[register-interest] store failed", err);
    return json({ ok: false, error: "store_failed" }, 500);
  }
  if (!result) {
    return json({ ok: false, error: "store_unavailable" }, 503);
  }

  const { row, created } = result;

  if (created || row.ghl_status !== "synced") {
    const push = await pushRegisterInterestToGhl(row, {
      tagSlug: tournament.slug,
      inviteBase: inviteBaseUrl(),
    });
    try {
      markGhl(row.id, push.status, push.contactId ?? null, push.error ?? null);
    } catch {
      /* status bookkeeping is best-effort */
    }
    if (push.status === "failed") {
      // eslint-disable-next-line no-console
      console.warn("[register-interest] ghl push failed", {
        id: row.id,
        error: push.error,
      });
    }
  }

  // The response is the same for a first and a repeat submit on purpose:
  // a `created` flag would tell a caller whether an email is already
  // registered (review 2026-10-17, RI-01).
  return json({
    ok: true,
    invite_code: row.invite_code,
    invite_url: `${inviteBaseUrl()}/i/${row.invite_code}`,
    referrals: referralCount(row.invite_code),
  });
}

export async function GET() {
  return Response.json(
    { ok: false, error: "POST only." },
    { status: 405, headers: { ...NO_STORE, allow: "POST" } },
  );
}
