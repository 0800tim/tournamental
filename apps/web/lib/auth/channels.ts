/**
 * Client for the auth-sms /v1/auth/channels endpoint.
 *
 * The SignupModal calls this on open to decide whether to render the
 * WhatsApp button. If the channel is currently disabled (admin button,
 * or auto-throttle from Baileys traffic), we hide WA and lead with
 * email-OTP instead.
 *
 * The response is short-edge-cached (s-maxage=10), so a manual flip
 * propagates to every active modal within ~10 seconds; we don't need
 * a poll loop on the client.
 *
 * Tim 2026-06-04.
 */

import { AUTH_BASE } from "./inbound-login";

export interface ChannelAvailability {
  readonly available: boolean;
  readonly reason: string | null;
}

export interface ChannelsState {
  readonly whatsapp: ChannelAvailability;
  readonly email: ChannelAvailability;
  readonly sms: ChannelAvailability;
  readonly telegram: ChannelAvailability;
}

/**
 * Default-open state used when the fetch fails. Whatsapp defaults to
 * available so a brief auth-sms outage doesn't artificially hide a
 * working channel; the request-otp path will still 503 with
 * `channel-unavailable` if the channel is actually disabled, and the
 * modal will re-fetch on the next open.
 */
export const DEFAULT_CHANNELS: ChannelsState = {
  whatsapp: { available: true, reason: null },
  email: { available: true, reason: null },
  sms: { available: true, reason: null },
  telegram: { available: true, reason: null },
};

export async function fetchChannelsState(
  signal?: AbortSignal,
): Promise<ChannelsState> {
  try {
    const r = await fetch(
      AUTH_BASE.replace(/\/$/, "") + "/v1/auth/channels",
      {
        method: "GET",
        signal,
        headers: { Accept: "application/json" },
      },
    );
    if (!r.ok) return DEFAULT_CHANNELS;
    const body = (await r.json()) as Partial<ChannelsState>;
    return {
      whatsapp: body.whatsapp ?? DEFAULT_CHANNELS.whatsapp,
      email: body.email ?? DEFAULT_CHANNELS.email,
      sms: body.sms ?? DEFAULT_CHANNELS.sms,
      telegram: body.telegram ?? DEFAULT_CHANNELS.telegram,
    };
  } catch {
    return DEFAULT_CHANNELS;
  }
}
