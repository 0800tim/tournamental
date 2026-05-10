/**
 * vtorn-watchdog CLI.
 *
 * Subcommands:
 *   ingest --source <s> --severity <sev> --title <t> [--id <id>]
 *          [--detail <d>] [--location <l>]
 *      → records a finding (file-mode; doesn't require the HTTP server)
 *
 *   ingest-jsonl --source <s> --file <path>
 *      → bulk-ingest a list of findings (one JSON object per line)
 *
 *   list [--severity <sev>] [--status <s>] [--since <ms>]
 *
 *   ack <id> --by <name> [--reason <r>]
 *   resolve <id> --by <name> [--reason <r>]
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { WatchdogStore } from './lib/storage.js';
import { type Finding, FindingSchema, type Severity } from './lib/types.js';

const DATA_DIR = process.env.WATCHDOG_DATA_DIR ?? join(process.cwd(), 'data');
const FINDINGS_PATH = join(DATA_DIR, 'findings.jsonl');
const AUDIT_PATH = join(DATA_DIR, 'audit.jsonl');

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

function bool(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function makeStore() {
  return new WatchdogStore({ findingsPath: FINDINGS_PATH, auditPath: AUDIT_PATH });
}

async function main() {
  const sub = process.argv[2];
  const argv = process.argv.slice(3);
  switch (sub) {
    case 'ingest': {
      const id = arg(argv, '--id') ?? `${arg(argv, '--source') ?? 'manual'}:${Date.now()}`;
      const f: Finding = FindingSchema.parse({
        id,
        source: arg(argv, '--source') ?? 'manual',
        severity: (arg(argv, '--severity') ?? 'medium') as Severity,
        status: 'open',
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        title: arg(argv, '--title') ?? 'untitled finding',
        detail: arg(argv, '--detail'),
        location: arg(argv, '--location'),
        tags: [],
      });
      const store = makeStore();
      const r = store.observe(f);
      console.log(JSON.stringify({ created: r.created, finding: r.finding }, null, 2));
      return;
    }
    case 'ingest-jsonl': {
      const path = arg(argv, '--file');
      if (!path || !existsSync(path)) {
        console.error('--file <jsonl> required');
        process.exit(2);
      }
      const store = makeStore();
      const lines = readFileSync(path, 'utf-8').split('\n');
      let observed = 0;
      let created = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line);
          const f = FindingSchema.parse({
            ...raw,
            firstSeenAt: raw.firstSeenAt ?? Date.now(),
            lastSeenAt: raw.lastSeenAt ?? Date.now(),
            status: raw.status ?? 'open',
          });
          const r = store.observe(f);
          observed += 1;
          if (r.created) created += 1;
        } catch (e) {
          console.warn(`skip malformed line: ${(e as Error).message}`);
        }
      }
      console.log(JSON.stringify({ observed, created }, null, 2));
      return;
    }
    case 'list': {
      const store = makeStore();
      const items = store.list({
        severityAtLeast: arg(argv, '--severity') as Severity | undefined,
        status: arg(argv, '--status') as Finding['status'] | undefined,
        since: arg(argv, '--since') ? Number(arg(argv, '--since')) : undefined,
      });
      console.log(JSON.stringify({ count: items.length, items }, null, 2));
      return;
    }
    case 'ack':
    case 'resolve':
    case 'dismiss': {
      const id = argv[0];
      if (!id) {
        console.error(`${sub} <id> --by <name> [--reason <r>] required`);
        process.exit(2);
      }
      const by = arg(argv, '--by') ?? 'cli';
      const reason = arg(argv, '--reason');
      const status = sub === 'ack' ? 'acknowledged' : sub === 'resolve' ? 'resolved' : 'dismissed';
      const store = makeStore();
      const updated = store.setStatus(id, status, by, reason);
      if (!updated) {
        console.error(`finding not found: ${id}`);
        process.exit(1);
      }
      console.log(JSON.stringify(updated, null, 2));
      return;
    }
    default:
      console.log(`vtorn-watchdog — security watchdog CLI

USAGE
  vtorn-watchdog <subcommand> [options]

SUBCOMMANDS
  ingest         Record a single finding
  ingest-jsonl   Bulk-ingest findings from a JSONL file
  list           List findings (optional filters)
  ack <id>       Mark finding as acknowledged
  resolve <id>   Mark finding as resolved
  dismiss <id>   Mark finding as dismissed
`);
      if (sub) process.exit(2);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(2);
});
