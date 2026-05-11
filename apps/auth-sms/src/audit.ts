/**
 * OTP audit log , append-only JSONL.
 *
 * Every OTP send and every OTP verify (success or failure) writes one
 * line to a log file. Fields are deliberately PII-free: we record the
 * truncated SHA-256 of the phone (same `phoneLogId` we use in pino
 * logs), the IP, the user-agent prefix, and the outcome. Operators
 * can grep this file for "five 401s from one IP across twenty
 * phoneIds" patterns without ever seeing a raw phone number.
 *
 * The path is configurable via `AUDIT_LOG_PATH`. The default in dev
 * is `./data/audit/otp.log.jsonl`. The directory is created on first
 * write. If the file cannot be opened (e.g. read-only filesystem)
 * we fall back to a no-op writer + a single pino warning so the
 * verify path is never blocked by an audit-log failure.
 *
 * Multi-tenant note: in production we ship one log per service
 * instance and aggregate with logrotate; this is intentionally simple.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export type AuditAction =
  | 'otp.send.ok'
  | 'otp.send.fail'
  | 'otp.send.rate-limited'
  | 'otp.verify.ok'
  | 'otp.verify.bad-code'
  | 'otp.verify.expired'
  | 'otp.verify.unknown-phone'
  | 'otp.verify.rate-limited'
  | 'otp.verify.locked-out';

export interface AuditFields {
  ts: string;
  action: AuditAction;
  /** Truncated SHA-256 of the phone, NEVER the plaintext. */
  phoneId: string;
  /** Channel hint (sms, whatsapp, telegram, ...). Optional. */
  channel?: string;
  /** Caller IP. May be empty if upstream did not forward it. */
  ip: string;
  /** User-agent, truncated to 128 chars. */
  ua?: string;
  /** Free-form reason / error code attached to the outcome. */
  reason?: string;
}

export interface AuditLogger {
  write(fields: Omit<AuditFields, 'ts'>): void;
}

class FileAuditLogger implements AuditLogger {
  private failed = false;
  constructor(
    private readonly path: string,
    private readonly warn: (msg: string) => void,
  ) {}

  write(fields: Omit<AuditFields, 'ts'>): void {
    if (this.failed) return;
    const line: AuditFields = {
      ts: new Date().toISOString(),
      ...fields,
    };
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, JSON.stringify(line) + '\n', { mode: 0o600 });
    } catch (err) {
      this.failed = true;
      this.warn(
        `audit: failed to write to ${this.path}: ${(err as Error).message}; ` +
          'falling back to no-op (verify path is not blocked).',
      );
    }
  }
}

class NoopAuditLogger implements AuditLogger {
  write(): void {
    /* no-op */
  }
}

class MemoryAuditLogger implements AuditLogger {
  readonly lines: AuditFields[] = [];
  write(fields: Omit<AuditFields, 'ts'>): void {
    this.lines.push({ ts: new Date().toISOString(), ...fields });
  }
}

/** Build the default audit logger from env (`AUDIT_LOG_PATH`). */
export function buildAuditLogger(opts: {
  path?: string;
  warn?: (msg: string) => void;
}): AuditLogger {
  if (opts.path === '' || opts.path === 'off') return new NoopAuditLogger();
  const target = opts.path ?? './data/audit/otp.log.jsonl';
  return new FileAuditLogger(target, opts.warn ?? (() => {}));
}

/** Build an in-memory audit logger for tests. */
export function buildMemoryAuditLogger(): MemoryAuditLogger {
  return new MemoryAuditLogger();
}

/** Truncate user-agent to a sensible length so log lines stay short. */
export function truncateUa(ua: string | undefined): string {
  if (!ua) return '';
  return ua.length > 128 ? ua.slice(0, 128) : ua;
}

/**
 * Hash an arbitrary subject (e.g. an email, a Discord user id) the same
 * way `phoneLogId` does for phones. Lets dm-otp share the same audit
 * shape without leaking the externalId.
 */
export function subjectLogId(subject: string): string {
  return createHash('sha256').update(subject).digest('hex').slice(0, 12);
}
