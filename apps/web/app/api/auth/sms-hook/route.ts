/**
 * POST /api/auth/sms-hook
 *
 * Supabase phone-auth "Custom SMS Provider" webhook.
 *
 * When the user requests a WhatsApp OTP via the SignupModal,
 * Supabase POSTs us a payload like:
 *
 *   {
 *     user: { id, phone },
 *     sms: { otp: "123456" }
 *   }
 *
 * We forward the OTP via the Aiva SMS gateway to the user's WhatsApp.
 * Supabase signs the request HMAC-SHA256 using SUPABASE_SMS_HOOK_SECRET
 * — we verify the signature before doing anything else.
 *
 * Reference:
 *   https://supabase.com/docs/guides/auth/phone-login/custom-sms-hook
 */

import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

interface Payload {
  user?: { id?: string; phone?: string };
  sms?: { otp?: string };
}

export async function POST(req: NextRequest) {
  const secret = process.env.SUPABASE_SMS_HOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "hook_disabled" }, { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-supabase-signature") ?? "";
  if (!verify(raw, signature, secret)) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(raw) as Payload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const ok = await sendWhatsAppOtp(phone, otp);
  if (!ok) {
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

function verify(raw: string, signature: string, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  // timingSafeEqual requires equal-length buffers.
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Aiva SMS gateway integration. Strips the leading "+" (per the
 * gateway's WhatsApp send-message convention) and POSTs the OTP via
 * the configured session.
 */
async function sendWhatsAppOtp(phone: string, otp: string): Promise<boolean> {
  const apiUrl = process.env.AIVA_SMS_API_URL || "http://localhost:9252";
  const apiKey = process.env.AIVA_SMS_API_KEY;
  const sessionId = process.env.AIVA_WA_SESSION_ID;
  if (!apiKey || !sessionId) return false;
  const cleaned = phone.replace(/\D/g, "");
  const message = `Your Tournamental code is: ${otp}\n\nIt expires in 10 minutes.`;
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/whatsapp/sessions/${sessionId}/send`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ phone: cleaned, message }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
