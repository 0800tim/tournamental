import { describe, it, expect } from 'vitest';
import { WatchdogStore } from '../src/lib/storage.js';
import type { Finding } from '../src/lib/types.js';

function f(over: Partial<Finding> = {}): Finding {
  return {
    id: 'gitleaks:abc:loc',
    source: 'gitleaks',
    severity: 'high',
    status: 'open',
    firstSeenAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_000_000,
    title: 'AWS access key',
    tags: [],
    ...over,
  };
}

function ephemeralStore() {
  return new WatchdogStore({
    findingsPath: '/tmp/_unused.jsonl',
    auditPath: '/tmp/_unused-audit.jsonl',
    ephemeral: true,
  });
}

describe('WatchdogStore', () => {
  it('observe creates a new finding', () => {
    const s = ephemeralStore();
    const r = s.observe(f());
    expect(r.created).toBe(true);
    expect(r.finding.id).toBe('gitleaks:abc:loc');
  });

  it('re-observing an open finding bumps lastSeenAt but preserves firstSeenAt', () => {
    const s = ephemeralStore();
    s.observe(f({ firstSeenAt: 1000, lastSeenAt: 1000 }), 1000);
    const second = s.observe(f({ firstSeenAt: 5000, lastSeenAt: 5000 }), 5000);
    expect(second.created).toBe(false);
    expect(second.finding.firstSeenAt).toBe(1000);
    expect(second.finding.lastSeenAt).toBe(5000);
  });

  it('preserves human-set status when re-observing', () => {
    const s = ephemeralStore();
    s.observe(f(), 1000);
    s.setStatus('gitleaks:abc:loc', 'acknowledged', 'tim', 'looked at it', 2000);
    const r = s.observe(f({ severity: 'critical' }), 3000);
    expect(r.finding.status).toBe('acknowledged');
    expect(r.finding.severity).toBe('critical');
  });

  it('list filters by status and severity', () => {
    const s = ephemeralStore();
    s.observe(f({ id: 'a', severity: 'low', title: 'A' }));
    s.observe(f({ id: 'b', severity: 'high', title: 'B' }));
    s.observe(f({ id: 'c', severity: 'critical', title: 'C' }));
    const high = s.list({ severityAtLeast: 'high' });
    expect(high.length).toBe(2);
  });

  it('counts roll up by severity', () => {
    const s = ephemeralStore();
    s.observe(f({ id: 'a', severity: 'low' }));
    s.observe(f({ id: 'b', severity: 'high' }));
    s.observe(f({ id: 'c', severity: 'high' }));
    const c = s.counts();
    expect(c.low).toBe(1);
    expect(c.high).toBe(2);
    expect(c.total).toBe(3);
    expect(c.open).toBe(3);
  });

  it('setStatus is idempotent for unknown ids', () => {
    const s = ephemeralStore();
    expect(s.setStatus('nope', 'resolved', 'tim')).toBeUndefined();
  });

  it('setStatus moves through lifecycle', () => {
    const s = ephemeralStore();
    s.observe(f());
    expect(s.get('gitleaks:abc:loc')?.status).toBe('open');
    s.setStatus('gitleaks:abc:loc', 'acknowledged', 'tim', 'noted');
    expect(s.get('gitleaks:abc:loc')?.status).toBe('acknowledged');
    s.setStatus('gitleaks:abc:loc', 'resolved', 'tim', 'fixed');
    expect(s.get('gitleaks:abc:loc')?.status).toBe('resolved');
  });

  it('audit log records status changes', () => {
    const s = ephemeralStore();
    s.observe(f());
    s.setStatus('gitleaks:abc:loc', 'acknowledged', 'tim', 'noted');
    const log = s.auditLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]?.action).toBe('finding:acknowledged');
  });
});
