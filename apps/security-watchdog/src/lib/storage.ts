/**
 * JSONL append-only storage with in-memory rebuild on boot.
 *
 * Two files:
 *   findings.jsonl   — one FindingEvent per line
 *   audit.jsonl      — one AuditEvent per line
 *
 * Concurrency: Node's fs.appendFileSync is atomic for small lines on
 * Linux. For v0.1 a single-process watchdog is fine; if we scale out,
 * front this with a queue.
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  AuditEventSchema,
  FindingEventSchema,
  type AuditEvent,
  type Finding,
  type FindingEvent,
  type FindingStatus,
} from './types.js';

export interface StorageOptions {
  findingsPath: string;
  auditPath: string;
  /** Skip file IO entirely (tests). */
  ephemeral?: boolean;
}

export class WatchdogStore {
  private readonly findingsPath: string;
  private readonly auditPath: string;
  private readonly ephemeral: boolean;
  private findings = new Map<string, Finding>();
  private auditEvents: AuditEvent[] = [];

  constructor(opts: StorageOptions) {
    this.findingsPath = opts.findingsPath;
    this.auditPath = opts.auditPath;
    this.ephemeral = opts.ephemeral ?? false;
    if (!this.ephemeral) this.ensureDirs();
    this.replay();
  }

  private ensureDirs(): void {
    for (const p of [this.findingsPath, this.auditPath]) {
      const d = dirname(p);
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  private replay(): void {
    if (this.ephemeral) return;
    if (existsSync(this.findingsPath)) {
      const lines = readFileSync(this.findingsPath, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = FindingEventSchema.parse(JSON.parse(line));
          this.applyEvent(ev);
        } catch {
          // Skip malformed lines — JSONL is forward-compatible.
        }
      }
    }
    if (existsSync(this.auditPath)) {
      const lines = readFileSync(this.auditPath, 'utf-8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.auditEvents.push(AuditEventSchema.parse(JSON.parse(line)));
        } catch {
          // Skip malformed lines.
        }
      }
    }
  }

  private applyEvent(ev: FindingEvent): void {
    if (ev.event === 'observed') {
      const existing = this.findings.get(ev.finding.id);
      if (existing) {
        // Preserve human-driven status when re-observing
        const merged: Finding = {
          ...ev.finding,
          status: existing.status === 'open' ? ev.finding.status : existing.status,
          firstSeenAt: existing.firstSeenAt,
          lastSeenAt: ev.at,
          ackBy: existing.ackBy,
          ackAt: existing.ackAt,
          ackReason: existing.ackReason,
        };
        this.findings.set(ev.finding.id, merged);
      } else {
        this.findings.set(ev.finding.id, {
          ...ev.finding,
          firstSeenAt: ev.finding.firstSeenAt || ev.at,
          lastSeenAt: ev.at,
        });
      }
    } else if (ev.event === 'status') {
      const existing = this.findings.get(ev.id);
      if (!existing) return;
      this.findings.set(ev.id, {
        ...existing,
        status: ev.status,
        ackBy: ev.by,
        ackAt: ev.at,
        ackReason: ev.reason,
      });
    }
  }

  observe(finding: Finding, at: number = Date.now()): { created: boolean; finding: Finding } {
    const existing = this.findings.get(finding.id);
    const ev: FindingEvent = {
      event: 'observed',
      at,
      finding: { ...finding, lastSeenAt: at, firstSeenAt: existing?.firstSeenAt ?? at },
    };
    this.applyEvent(ev);
    if (!this.ephemeral) {
      appendFileSync(this.findingsPath, JSON.stringify(ev) + '\n', 'utf-8');
    }
    const updated = this.findings.get(finding.id);
    if (!updated) throw new Error('observe: finding missing after apply');
    return { created: !existing, finding: updated };
  }

  setStatus(
    id: string,
    status: FindingStatus,
    by: string,
    reason?: string,
    at: number = Date.now(),
  ): Finding | undefined {
    if (!this.findings.has(id)) return undefined;
    const ev: FindingEvent = { event: 'status', at, id, status, by, reason };
    this.applyEvent(ev);
    if (!this.ephemeral) {
      appendFileSync(this.findingsPath, JSON.stringify(ev) + '\n', 'utf-8');
    }
    this.audit({ at, actor: by, action: `finding:${status}`, target: id, meta: { reason } });
    return this.findings.get(id);
  }

  audit(ev: AuditEvent): void {
    const parsed = AuditEventSchema.parse(ev);
    this.auditEvents.push(parsed);
    if (!this.ephemeral) {
      appendFileSync(this.auditPath, JSON.stringify(parsed) + '\n', 'utf-8');
    }
  }

  list(filter?: {
    status?: FindingStatus;
    severityAtLeast?: 'info' | 'low' | 'medium' | 'high' | 'critical';
    since?: number;
    source?: string;
  }): Finding[] {
    const order: Finding['severity'][] = ['info', 'low', 'medium', 'high', 'critical'];
    const minIdx = filter?.severityAtLeast ? order.indexOf(filter.severityAtLeast) : 0;
    const out: Finding[] = [];
    for (const f of this.findings.values()) {
      if (filter?.status && f.status !== filter.status) continue;
      if (filter?.since && f.lastSeenAt < filter.since) continue;
      if (filter?.source && f.source !== filter.source) continue;
      if (order.indexOf(f.severity) < minIdx) continue;
      out.push(f);
    }
    out.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    return out;
  }

  get(id: string): Finding | undefined {
    return this.findings.get(id);
  }

  auditLog(limit = 200): AuditEvent[] {
    return this.auditEvents.slice(-limit).reverse();
  }

  counts(): Record<Finding['severity'] | 'open' | 'total', number> {
    const c: Record<string, number> = {
      info: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
      open: 0,
      total: 0,
    };
    for (const f of this.findings.values()) {
      c[f.severity] = (c[f.severity] ?? 0) + 1;
      c.total = (c.total ?? 0) + 1;
      if (f.status === 'open') c.open = (c.open ?? 0) + 1;
    }
    return c as Record<Finding['severity'] | 'open' | 'total', number>;
  }
}
