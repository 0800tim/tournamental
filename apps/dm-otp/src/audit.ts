/**
 * Audit logger — JSONL.
 *
 * Every code-issuance and verify gets one line. We never write the OTP
 * in plaintext; only the masked form (`*****1`). External IDs are also
 * masked (last 4 chars retained).
 *
 * Failure to write the audit log NEVER fails the user-visible request.
 * We surface a warn-log instead — the auditor's job is to spot-check.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { maskCode } from './otp.js';
import type { DmChannel } from './jwt.js';

export interface AuditEvent {
  ts: string; // ISO
  type: 'issued' | 'verified' | 'verify-failed';
  channel: DmChannel;
  /** Last 4 chars of the channel-side ID; e.g. "...4567". */
  externalIdMask: string;
  /** Masked code; never plaintext. */
  codeMask: string;
  /** Issued: how the code was generated. Verified: outcome. */
  reason?: string;
}

export interface AuditWriter {
  write(event: AuditEvent): void;
}

export function maskExternalId(id: string): string {
  if (!id) return '';
  if (id.length <= 4) return `***${id.slice(-1)}`;
  return `***${id.slice(-4)}`;
}

export class JsonlAuditWriter implements AuditWriter {
  private readonly path: string;
  private readonly onError: (err: unknown) => void;
  constructor(opts: { path: string; onError?: (err: unknown) => void }) {
    this.path = opts.path;
    this.onError = opts.onError ?? (() => {});
    try {
      mkdirSync(dirname(this.path), { recursive: true });
    } catch (err) {
      this.onError(err);
    }
  }

  write(event: AuditEvent): void {
    try {
      appendFileSync(this.path, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      this.onError(err);
    }
  }
}

/** No-op writer for tests. */
export class MemoryAuditWriter implements AuditWriter {
  events: AuditEvent[] = [];
  write(event: AuditEvent): void {
    this.events.push(event);
  }
}

export function makeIssuedEvent(opts: {
  channel: DmChannel;
  externalId: string;
  code: string;
  ts?: number;
}): AuditEvent {
  return {
    ts: new Date(opts.ts ?? Date.now()).toISOString(),
    type: 'issued',
    channel: opts.channel,
    externalIdMask: maskExternalId(opts.externalId),
    codeMask: maskCode(opts.code),
  };
}

export function makeVerifyEvent(opts: {
  channel: DmChannel;
  externalId: string;
  code: string;
  ok: boolean;
  reason?: string;
  ts?: number;
}): AuditEvent {
  return {
    ts: new Date(opts.ts ?? Date.now()).toISOString(),
    type: opts.ok ? 'verified' : 'verify-failed',
    channel: opts.channel,
    externalIdMask: maskExternalId(opts.externalId),
    codeMask: maskCode(opts.code),
    reason: opts.reason,
  };
}
