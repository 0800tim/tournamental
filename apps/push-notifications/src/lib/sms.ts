/**
 * SMS channel adapter.
 *
 * Delegates to the shared `@vtorn/aiva-client` clients:
 *   - `AivaSmsClient` when `AIVA_SMS_API_KEY` (and `AIVA_SMS_DEVICE_ID`) are
 *     set — real network send via the Aiva gateway.
 *   - `StubSmsClient` otherwise — logs locally and returns ok:true so dev
 *     doesn't block on SMS provisioning.
 *
 * Privacy: every send (real or stub) appends a one-line JSONL record to
 * `data/sms-audit.jsonl`. Recipient phone numbers are masked to their last
 * four digits so the audit log never contains a PII-grade phone number.
 *
 * Env (single source of truth — owned by `@vtorn/aiva-client`):
 *   AIVA_SMS_API_URL    base URL (default http://localhost:9252)
 *   AIVA_SMS_API_KEY    bearer token
 *   AIVA_SMS_DEVICE_ID  Android device UUID to send from
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import {
  AivaSmsClient,
  StubSmsClient,
  type SendSmsResult,
  type SmsSender,
} from '@vtorn/aiva-client';

import type { AuditLogger } from './audit.js';

export interface SmsPayload {
  /** Plain SMS body (no markdown). */
  body: string;
}

export interface SmsResult {
  ok: boolean;
  errorMessage?: string;
}

export type SmsEvent = 'kickoff_soon' | 'match_result' | 'leaderboard_move';

export interface SmsSenderConfig {
  audit: AuditLogger;
  /** Path for the privacy-masked SMS audit JSONL. Default ./data/sms-audit.jsonl. */
  smsAuditPath?: string;
  /** Raw env values — passed through so callers don't need to import @vtorn/aiva-client. */
  apiUrl?: string;
  apiKey?: string;
  deviceId?: string;
  /** Optional override for tests (also forwarded to the real client). */
  client?: SmsSender;
  /** Optional logger so stub messages surface in service logs in dev. */
  log?: (msg: string) => void;
}

/**
 * Mask a phone number to its last 4 digits for audit logs. We never log
 * the full number — operators can correlate via user ID + last-4.
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return `****${digits}`;
  return `****${digits.slice(-4)}`;
}

interface SmsAuditRecord {
  ts: string;
  userId: string;
  event: SmsEvent;
  recipientLast4: string;
  template: string;
  length: number;
  status: 'ok' | 'failed';
  mode: 'aiva' | 'stub';
  errorCode?: string;
}

async function appendSmsAudit(path: string, record: SmsAuditRecord): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.appendFile(path, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * SmsSender used by the dispatcher. Wraps either an `AivaSmsClient` or a
 * `StubSmsClient` and writes to two audit logs:
 *   1. The shared push-notifications audit log (`data/audit.jsonl`) for
 *      cross-channel observability.
 *   2. The privacy-masked SMS-only audit log (`data/sms-audit.jsonl`).
 */
export class AivaSmsAdapter {
  private readonly cfg: SmsSenderConfig;
  private readonly client: SmsSender;
  private readonly mode: 'aiva' | 'stub';
  private readonly smsAuditPath: string;

  constructor(cfg: SmsSenderConfig) {
    this.cfg = cfg;
    this.smsAuditPath = cfg.smsAuditPath ?? './data/sms-audit.jsonl';
    if (cfg.client) {
      this.client = cfg.client;
      this.mode = cfg.client instanceof AivaSmsClient ? 'aiva' : 'stub';
      return;
    }
    if (cfg.apiKey && cfg.deviceId) {
      this.client = new AivaSmsClient({
        baseUrl: cfg.apiUrl ?? 'http://localhost:9252',
        apiKey: cfg.apiKey,
        deviceId: cfg.deviceId,
      });
      this.mode = 'aiva';
    } else {
      const log = cfg.log ?? ((msg: string) => console.warn(msg));
      log(
        '[sms] AIVA_SMS_API_KEY/AIVA_SMS_DEVICE_ID not set — falling back to StubSmsClient',
      );
      this.client = new StubSmsClient(log);
      this.mode = 'stub';
    }
  }

  async send(
    userId: string,
    phone: string,
    payload: SmsPayload,
    event: SmsEvent,
  ): Promise<SmsResult> {
    const e164 = phone.startsWith('+') ? phone : `+${phone}`;
    const recipientLast4 = maskPhone(e164);

    let result: SendSmsResult;
    try {
      result = await this.client.send({ to: e164, body: payload.body });
    } catch (err) {
      result = {
        ok: false,
        errorCode: 'exception',
        errorMessage: err instanceof Error ? err.message : 'sms send threw',
      };
    }

    // Privacy-masked SMS audit (last 4 digits only).
    await appendSmsAudit(this.smsAuditPath, {
      ts: new Date().toISOString(),
      userId,
      event,
      recipientLast4,
      template: event,
      length: payload.body.length,
      status: result.ok ? 'ok' : 'failed',
      mode: this.mode,
      errorCode: result.ok ? undefined : result.errorCode,
    });

    // Cross-channel audit log — keep the existing shape but mask the phone.
    await this.cfg.audit.append({
      channel: 'sms',
      userId,
      event,
      payload: {
        to: recipientLast4,
        body: payload.body,
      },
      ok: result.ok,
      note:
        this.mode === 'aiva'
          ? result.ok
            ? 'aiva: delivered to gateway'
            : `aiva: send failed (${result.errorCode ?? 'unknown'})`
          : 'stub: AIVA_SMS_API_KEY not configured; logged-only',
    });

    return result.ok
      ? { ok: true }
      : { ok: false, errorMessage: result.errorMessage };
  }
}

/**
 * Backwards-compatible alias. The dispatcher used to wire `StubSmsSender`;
 * the adapter now talks to the real or stub client transparently, so we keep
 * the old name as a re-export to avoid touching callers we don't own.
 */
export { AivaSmsAdapter as StubSmsSender };
