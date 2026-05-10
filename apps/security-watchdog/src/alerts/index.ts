/**
 * Alert sinks — pluggable delivery channels.
 *
 * Each sink takes a Finding and returns a delivery promise. Failures are
 * captured to alert-failed.jsonl by the dispatcher. Sinks are configured
 * via env at boot; missing env => sink disabled (no-op).
 *
 * Severity routing:
 *   info / low : log only (no sinks)
 *   medium     : channel sinks (Slack / Discord / Telegram)
 *   high       : channel + on-call (aiva-sms)
 *   critical   : on-call + email
 */

import { ALERT_LEVEL, type Finding } from '../lib/types.js';

export interface AlertSink {
  name: string;
  enabled: boolean;
  deliver(finding: Finding): Promise<void>;
}

export interface DispatchResult {
  delivered: string[];
  failed: Array<{ sink: string; error: string }>;
}

export interface DispatcherOptions {
  sinks: AlertSink[];
  /** When true, the dispatcher always returns success (test mode). */
  swallowErrors?: boolean;
  /** Hook for the dead-letter writer. */
  onFailure?: (sink: string, finding: Finding, error: string) => void;
}

/**
 * Decide which sinks to fire for a given finding's severity.
 */
export function sinksForSeverity(level: 'log' | 'channel' | 'oncall' | 'page', sinks: AlertSink[]): AlertSink[] {
  const enabled = sinks.filter((s) => s.enabled);
  switch (level) {
    case 'log':
      return [];
    case 'channel':
      return enabled.filter((s) => s.name === 'slack' || s.name === 'discord' || s.name === 'telegram');
    case 'oncall':
      return enabled.filter(
        (s) => s.name === 'slack' || s.name === 'discord' || s.name === 'telegram' || s.name === 'aiva-sms',
      );
    case 'page':
      return enabled;
  }
}

export class AlertDispatcher {
  constructor(private readonly opts: DispatcherOptions) {}

  async dispatch(finding: Finding): Promise<DispatchResult> {
    const level = ALERT_LEVEL[finding.severity];
    const targets = sinksForSeverity(level, this.opts.sinks);
    const delivered: string[] = [];
    const failed: Array<{ sink: string; error: string }> = [];
    for (const sink of targets) {
      try {
        await sink.deliver(finding);
        delivered.push(sink.name);
      } catch (e) {
        const err = (e as Error).message;
        failed.push({ sink: sink.name, error: err });
        this.opts.onFailure?.(sink.name, finding, err);
        if (!this.opts.swallowErrors) {
          // continue; don't throw — best-effort delivery
        }
      }
    }
    return { delivered, failed };
  }
}
