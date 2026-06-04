/**
 * /channels, admin toggle for the OTP delivery channels.
 *
 * Today we surface a single control: the WhatsApp channel flag. The
 * page reads the current state server-side from auth-sms then hands
 * to a client component for the toggle UI. Edits hit
 * `/api/admin/channels/whatsapp` which proxies to auth-sms with the
 * shared admin token so the operator's browser never sees the secret.
 *
 * Use case: half an hour before a TV slot or a podcast mention, the
 * operator flips WhatsApp off so all signups are forced to email
 * OTP. This keeps Meta's automated-traffic detector from flagging
 * our Baileys-driven personal WhatsApp account. After the spike
 * settles, the operator flips it back on.
 *
 * Tim 2026-06-04.
 */

import { requireAuth, getAuthSmsBase } from "@/lib/auth";

import { ChannelsClient } from "./ChannelsClient";

export const dynamic = "force-dynamic";

interface ChannelState {
  readonly available: boolean;
  readonly reason: string | null;
}

interface ChannelsResponse {
  readonly whatsapp: ChannelState;
  readonly email: ChannelState;
  readonly sms: ChannelState;
  readonly telegram: ChannelState;
}

async function loadChannels(): Promise<ChannelsResponse | null> {
  try {
    const r = await fetch(`${getAuthSmsBase()}/v1/auth/channels`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!r.ok) return null;
    return (await r.json()) as ChannelsResponse;
  } catch {
    return null;
  }
}

export default async function ChannelsPage() {
  await requireAuth();
  const channels = await loadChannels();

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">OTP channels</h1>
        <p className="text-sm text-ink-200">
          Toggle the channels users see in the sign-in modal. Flip
          WhatsApp off ahead of a publicity spike so Meta does not
          throttle our Baileys-driven personal account. Flipping back
          on takes effect within ~10 seconds across all clients.
        </p>
      </header>
      <ChannelsClient initialState={channels} />
    </div>
  );
}
