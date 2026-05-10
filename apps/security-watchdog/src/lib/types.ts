/**
 * Shared types for the security-watchdog.
 *
 * The watchdog persists three kinds of records to JSONL files:
 *
 *   findings.jsonl       — security findings raised by scanners
 *   audit.jsonl          — every dashboard/admin action (ack, resolve,
 *                          dismiss, false-positive)
 *   alert-failed.jsonl   — alert-sink delivery failures (dead-letter)
 *
 * In-memory state is rebuilt on boot by replaying findings.jsonl in
 * file order. Newer rows for the same finding-id supersede older ones.
 */

import { z } from 'zod';

export const SeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

export const FindingStatusSchema = z.enum([
  'open',
  'acknowledged',
  'resolved',
  'dismissed',
  'false-positive',
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingSourceSchema = z.enum([
  'gitleaks',
  'osv-scanner',
  'semgrep',
  'license-audit',
  'network-allowlist',
  'npm-audit',
  'pip-audit',
  'manual',
  'pr-triage',
  'codeowners',
]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FindingSchema = z.object({
  /** Stable de-dupe key: `<source>:<scanner-id>:<location-hash>`. */
  id: z.string().min(1).max(200),
  source: FindingSourceSchema,
  severity: SeveritySchema,
  status: FindingStatusSchema.default('open'),
  /** When the watchdog first observed this finding (ms since epoch). */
  firstSeenAt: z.number().int().nonnegative(),
  /** When the watchdog most-recently observed this finding. */
  lastSeenAt: z.number().int().nonnegative(),
  /** Short human-readable summary. */
  title: z.string().min(1).max(300),
  /** Optional longer text. */
  detail: z.string().max(4000).optional(),
  /** File path or URL the finding pertains to. */
  location: z.string().max(500).optional(),
  /** Free-form tags for filtering on the dashboard. */
  tags: z.array(z.string().max(60)).max(30).default([]),
  /** Latest acknowledger metadata (filled by ack/resolve). */
  ackBy: z.string().max(120).optional(),
  ackAt: z.number().int().nonnegative().optional(),
  ackReason: z.string().max(2000).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** A delta event written to findings.jsonl. */
export const FindingEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('observed'),
    at: z.number().int().nonnegative(),
    finding: FindingSchema,
  }),
  z.object({
    event: z.literal('status'),
    at: z.number().int().nonnegative(),
    id: z.string(),
    status: FindingStatusSchema,
    by: z.string(),
    reason: z.string().max(2000).optional(),
  }),
]);
export type FindingEvent = z.infer<typeof FindingEventSchema>;

export const AuditEventSchema = z.object({
  at: z.number().int().nonnegative(),
  actor: z.string(),
  action: z.string(),
  target: z.string(),
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * Severity → routing target. Drives which alert sinks fire.
 *
 *   - info / low: log only; surface on dashboard
 *   - medium:     post to channel sinks (Slack / Discord)
 *   - high:       channel sinks + on-call SMS via aiva-sms
 *   - critical:   high + email + (optionally) auto-disable affected env
 */
export const ALERT_LEVEL: Record<Severity, 'log' | 'channel' | 'oncall' | 'page'> = {
  info: 'log',
  low: 'log',
  medium: 'channel',
  high: 'oncall',
  critical: 'page',
};
