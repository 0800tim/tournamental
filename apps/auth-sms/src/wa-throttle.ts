/**
 * WhatsApp send-rate throttle.
 *
 * We drive a personal WhatsApp account via Baileys (not WhatsApp
 * Business API). Personal accounts are aggressively rate-limited
 * and ban-prone when they look automated: anecdotal community
 * thresholds put the safe ceiling for OTP-shaped traffic at roughly
 * 30-50 outbound messages per hour before Meta starts flagging the
 * account. A ban during a live spike (Tim's TV slot) is unrecoverable
 * inside the window because re-pairing requires the operator to scan
 * a QR with the SIM.
 *
 * This module is the safety net that auto-disables the WhatsApp
 * channel before that happens. It is NOT the primary defence; the
 * primary defence is the admin flipping the channel off manually
 * before the spike starts.
 *
 * Design:
 *   - Per-channel send counter lives in the existing rate_limit
 *     table keyed `channel_send:whatsapp`, rolling-hour bucket.
 *   - On every send we bump the counter and, if it crosses the
 *     disable threshold, flip channel_state.whatsapp.enabled=false
 *     with source="auto_throttle" and auto_re_enable_at=now+2h.
 *   - A periodic sweep (re_enable_if_due) re-enables the channel
 *     once the cool-down window passes if nobody flipped it manually.
 *   - The flag is read from SQLite on every send, so once flipped
 *     by any worker, all workers see it on their next read. No
 *     in-process state to keep coherent across the cluster.
 *
 * Tim 2026-06-04.
 */

import type { Storage, ChannelState } from './storage.js';

/**
 * Safe thresholds for the personal-WhatsApp / Baileys path. Tightened
 * deliberately vs the WhatsApp Business API tier so we stay far below
 * Meta's flagging window.
 */
export interface WaThrottleConfig {
  /** Send count per rolling hour at which we auto-disable WhatsApp. */
  readonly disableAtPerHour: number;
  /** Optional warn threshold; we emit a log line at this count, no flag flip. */
  readonly warnAtPerHour: number;
  /** Seconds to wait before auto re-enabling. */
  readonly reEnableAfterSeconds: number;
}

export const WA_THROTTLE_DEFAULTS: WaThrottleConfig = {
  disableAtPerHour: 25,
  warnAtPerHour: 15,
  reEnableAfterSeconds: 7200, // 2 hours
};

export const WA_CHANNEL = 'whatsapp';

export interface WaThrottleDeps {
  readonly storage: Storage;
  readonly config: WaThrottleConfig;
  readonly nowSeconds: () => number;
  readonly log: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Check whether the WhatsApp channel is currently available for new
 * sends. Returns the live ChannelState (synthesises an "enabled" row
 * on first read so the public endpoint can mirror the same shape).
 *
 * This is the only function send paths need to call before issuing a
 * WhatsApp message; the recordSend / re_enable_if_due maintenance is
 * driven by other entry points.
 */
export function getWhatsAppAvailability(
  deps: WaThrottleDeps,
): ChannelState {
  const existing = deps.storage.getChannelState(WA_CHANNEL);
  if (existing) {
    // If the auto-throttle disabled it and the cool-down has elapsed,
    // re-enable on read so the next send doesn't trip the same check.
    if (
      !existing.enabled &&
      existing.source === 'auto_throttle' &&
      existing.autoReEnableAt !== null &&
      existing.autoReEnableAt <= deps.nowSeconds()
    ) {
      const now = deps.nowSeconds();
      deps.storage.upsertChannelState({
        channel: WA_CHANNEL,
        enabled: true,
        reason: `auto: cool-down expired (was: ${existing.reason ?? 'n/a'})`,
        source: 'auto_throttle',
        changedAt: now,
        autoReEnableAt: null,
      });
      deps.log('wa-throttle: cool-down expired, channel re-enabled', {
        previousReason: existing.reason,
      });
      return {
        channel: WA_CHANNEL,
        enabled: true,
        reason: `auto: cool-down expired (was: ${existing.reason ?? 'n/a'})`,
        source: 'auto_throttle',
        changedAt: now,
        autoReEnableAt: null,
      };
    }
    return existing;
  }
  // First read: synthesise the default "enabled" row so subsequent
  // writes have something to UPSERT against.
  const now = deps.nowSeconds();
  const fresh: ChannelState = {
    channel: WA_CHANNEL,
    enabled: true,
    reason: null,
    source: 'boot',
    changedAt: now,
    autoReEnableAt: null,
  };
  deps.storage.upsertChannelState({ ...fresh });
  return fresh;
}

/**
 * Record a successful (or attempted) WhatsApp send and, if the
 * resulting rolling-hour count crosses the configured threshold,
 * auto-disable the channel. Returns whether the channel is still
 * enabled after this call so the caller can short-circuit if the
 * threshold was tripped by *this* send.
 */
export function recordWhatsAppSend(deps: WaThrottleDeps): {
  countThisHour: number;
  stillEnabled: boolean;
  thresholdHit: boolean;
} {
  const now = deps.nowSeconds();
  const count = deps.storage.bumpChannelSendCounter(WA_CHANNEL, now);

  if (count === deps.config.warnAtPerHour) {
    deps.log('wa-throttle: warn threshold reached', {
      count,
      warnAt: deps.config.warnAtPerHour,
      disableAt: deps.config.disableAtPerHour,
    });
  }

  if (count >= deps.config.disableAtPerHour) {
    const existing = deps.storage.getChannelState(WA_CHANNEL);
    // Only flip if it isn't already disabled (so we don't keep
    // bumping changedAt or stomping an admin-set reason).
    if (!existing || existing.enabled) {
      deps.storage.upsertChannelState({
        channel: WA_CHANNEL,
        enabled: false,
        reason: `auto: ${count} sends in last hour (threshold ${deps.config.disableAtPerHour})`,
        source: 'auto_throttle',
        changedAt: now,
        autoReEnableAt: now + deps.config.reEnableAfterSeconds,
      });
      deps.log('wa-throttle: AUTO-DISABLED', {
        count,
        threshold: deps.config.disableAtPerHour,
        reEnableAt: new Date((now + deps.config.reEnableAfterSeconds) * 1000).toISOString(),
      });
      return { countThisHour: count, stillEnabled: false, thresholdHit: true };
    }
  }

  const state = deps.storage.getChannelState(WA_CHANNEL);
  return {
    countThisHour: count,
    stillEnabled: state?.enabled ?? true,
    thresholdHit: false,
  };
}

/**
 * Admin entry point: flip the channel state with an explicit
 * reason. Source="admin" so the auto-throttle never overrides it
 * via the cool-down sweep (admin disables are sticky).
 */
export function setWhatsAppEnabledByAdmin(
  deps: WaThrottleDeps,
  enabled: boolean,
  reason: string,
): ChannelState {
  const now = deps.nowSeconds();
  deps.storage.upsertChannelState({
    channel: WA_CHANNEL,
    enabled,
    reason: `admin: ${reason}`,
    source: 'admin',
    changedAt: now,
    autoReEnableAt: null,
  });
  deps.log(`wa-throttle: admin set enabled=${enabled}`, { reason });
  return {
    channel: WA_CHANNEL,
    enabled,
    reason: `admin: ${reason}`,
    source: 'admin',
    changedAt: now,
    autoReEnableAt: null,
  };
}
