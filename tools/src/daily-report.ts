#!/usr/bin/env node
/**
 * VTourn daily progress report generator.
 *
 * Walks the repo and produces a markdown summary at
 * `sessions/daily/<YYYY-MM-DD>.md`. Designed to be run by cron (see
 * `tools/daily-report-cron.sh`) or by a human via `pnpm daily-report`.
 *
 * Data sources
 * ------------
 *   - `git log --since=… --until=…` over the chosen day (UTC)
 *   - Conventional Commit subject prefixes (`feat`, `fix`, `docs`, …)
 *   - `apps/*\/package.json` and `packages/*\/package.json` workspace inventory
 *   - Each app's `start` / `dev` script grepped for `--port` / `-p`
 *   - `pnpm test --run --reporter=basic` tail (best-effort, optional)
 *   - `gh pr list --json …` open PRs (best-effort, optional)
 *
 * Idempotency
 * -----------
 *   First run for a date overwrites nothing — it writes a fresh file.
 *   Subsequent runs append `## Update appended at <HH:MM UTC>` so we
 *   never lose hand-edited prose from the orchestrator.
 *
 * Modes
 * -----
 *   `--dry-run`  print the rendered markdown to stdout and exit 0.
 *   `--date=…`   override the report date (default: today UTC).
 *   `--repo=…`   override the repo root (default: walk up from cwd).
 *
 * The script never commits — `daily-report-cron.sh` owns the git
 * surface so a developer can preview safely.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommitSummary {
  hash: string;
  subject: string;
  type: string | null;
  scope: string | null;
}

export interface CommitTypeCount {
  type: string;
  count: number;
}

export interface WorkspaceEntry {
  /** "apps" or "packages". */
  group: 'apps' | 'packages';
  /** Directory name (e.g. "web"). */
  dir: string;
  /** package.json `name`, or the dir name if missing. */
  name: string;
  /** Extracted port from the start/dev script, if any. */
  port: number | null;
  /** Description from package.json, if any. */
  description: string | null;
}

export interface OpenPullRequest {
  number: number;
  title: string;
  createdAt: string;
  state: string;
}

export interface ReportData {
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Long-form weekday + date e.g. "Sunday 11 May 2026". */
  longDate: string;
  /** ISO instant when the report ran. */
  generatedAt: string;
  commits: CommitSummary[];
  commitTypeCounts: CommitTypeCount[];
  apps: WorkspaceEntry[];
  packages: WorkspaceEntry[];
  testSummary: string | null;
  openPRs: OpenPullRequest[];
  /** Notes about non-fatal errors (gh missing, pnpm test failure, …). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export interface CliArgs {
  date: string;
  dryRun: boolean;
  repoRoot: string;
  skipTests: boolean;
}

export function parseArgs(argv: string[], todayUtcIso: string, defaultRoot: string): CliArgs {
  let date = todayUtcIso;
  let dryRun = false;
  let repoRoot = defaultRoot;
  let skipTests = false;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--skip-tests') {
      skipTests = true;
    } else if (arg.startsWith('--date=')) {
      date = arg.slice('--date='.length);
    } else if (arg.startsWith('--repo=')) {
      repoRoot = resolve(arg.slice('--repo='.length));
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid --date=${date}; expected YYYY-MM-DD.`);
  }
  return { date, dryRun, repoRoot, skipTests };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage: daily-report [options]',
      '',
      'Options:',
      '  --date=YYYY-MM-DD   Report date (default: today UTC).',
      '  --repo=<path>       Repository root (default: auto-detected).',
      '  --dry-run           Print to stdout, do not write a file.',
      '  --skip-tests        Skip running pnpm test (faster locally).',
      '  -h, --help          Show this help.',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function todayUtcIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function formatLongDate(isoDate: string): string {
  // Construct as UTC midnight to avoid local-tz drift.
  const d = new Date(`${isoDate}T00:00:00Z`);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const day = d.getUTCDate();
  const month = d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const year = d.getUTCFullYear();
  return `${weekday} ${day} ${month} ${year}`;
}

export function dayBoundsUtc(isoDate: string): { since: string; until: string } {
  return { since: `${isoDate}T00:00:00Z`, until: `${isoDate}T23:59:59Z` };
}

// ---------------------------------------------------------------------------
// Repo discovery
// ---------------------------------------------------------------------------

export function findRepoRoot(start: string): string {
  let cur = resolve(start);
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(cur, 'pnpm-workspace.yaml')) && existsSync(join(cur, '.git'))) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  // Fall back to the start dir; the caller will surface a useful error.
  return resolve(start);
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export function readGitLog(repoRoot: string, isoDate: string): CommitSummary[] {
  const { since, until } = dayBoundsUtc(isoDate);
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['log', `--since=${since}`, `--until=${until}`, '--pretty=%H %s'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return [];
  }
  return parseGitLogOutput(out);
}

export function parseGitLogOutput(raw: string): CommitSummary[] {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: CommitSummary[] = [];
  for (const line of lines) {
    const sp = line.indexOf(' ');
    if (sp <= 0) continue;
    const hash = line.slice(0, sp);
    const subject = line.slice(sp + 1);
    const { type, scope } = parseConventionalSubject(subject);
    out.push({ hash: hash.slice(0, 7), subject, type, scope });
  }
  return out;
}

const CONVENTIONAL_RE =
  /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?!?:\s/;

export function parseConventionalSubject(subject: string): {
  type: string | null;
  scope: string | null;
} {
  const m = CONVENTIONAL_RE.exec(subject);
  if (!m || !m.groups) return { type: null, scope: null };
  return { type: m.groups.type ?? null, scope: m.groups.scope ?? null };
}

export function summariseCommitTypes(commits: CommitSummary[]): CommitTypeCount[] {
  const counts = new Map<string, number>();
  for (const c of commits) {
    if (!c.type) continue;
    counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

// ---------------------------------------------------------------------------
// Workspace inventory
// ---------------------------------------------------------------------------

export function readWorkspace(repoRoot: string): {
  apps: WorkspaceEntry[];
  packages: WorkspaceEntry[];
} {
  return {
    apps: readGroup(repoRoot, 'apps'),
    packages: readGroup(repoRoot, 'packages'),
  };
}

function readGroup(repoRoot: string, group: 'apps' | 'packages'): WorkspaceEntry[] {
  const groupDir = join(repoRoot, group);
  if (!existsSync(groupDir)) return [];
  const entries: WorkspaceEntry[] = [];
  for (const dir of readdirSync(groupDir).sort()) {
    const pkgPath = join(groupDir, dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    let pkg: Record<string, unknown> = {};
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const port = extractPort(scripts.start) ?? extractPort(scripts.dev);
    entries.push({
      group,
      dir,
      name: typeof pkg.name === 'string' ? pkg.name : dir,
      port,
      description: typeof pkg.description === 'string' ? pkg.description : null,
    });
  }
  return entries;
}

const PORT_PATTERNS: RegExp[] = [
  /--port[= ](\d{2,5})/,
  /\s-p\s+(\d{2,5})/,
  /\s-p(\d{2,5})\b/,
  /PORT[=:](\d{2,5})/,
];

export function extractPort(script: string | undefined): number | null {
  if (!script) return null;
  for (const re of PORT_PATTERNS) {
    const m = re.exec(script);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0 && n < 65_536) return n;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function runTestSummary(
  repoRoot: string,
  warnings: string[],
): string | null {
  try {
    const out = execFileSync(
      'sh',
      ['-c', 'pnpm test --run --reporter=basic 2>/dev/null | tail -3'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600_000 },
    );
    const trimmed = out.trim();
    if (!trimmed) {
      warnings.push('pnpm test produced no output');
      return null;
    }
    return trimmed;
  } catch (err) {
    warnings.push(`pnpm test failed: ${(err as Error).message.split('\n')[0]}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Open PRs (gh CLI)
// ---------------------------------------------------------------------------

export function listOpenPRs(repoRoot: string, warnings: string[]): OpenPullRequest[] {
  try {
    const out = execFileSync(
      'gh',
      ['pr', 'list', '--state', 'open', '--json', 'number,title,createdAt,state', '--limit', '50'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 },
    );
    const parsed = JSON.parse(out) as OpenPullRequest[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    warnings.push(`gh pr list unavailable: ${(err as Error).message.split('\n')[0]}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

export function renderReport(data: ReportData): string {
  const lines: string[] = [];

  // YAML front-matter — matches the shape of 2026-05-10.md.
  lines.push('---');
  lines.push(`date: ${data.date}`);
  lines.push('author: daily-report-bot');
  lines.push(`commits: ${data.commits.length}`);
  lines.push(`apps: ${data.apps.length}`);
  lines.push(`packages: ${data.packages.length}`);
  if (data.testSummary) {
    const oneLine = data.testSummary.split('\n').slice(-1)[0]?.trim() ?? '';
    lines.push(`tests: ${oneLine.replace(/"/g, "'")}`);
  }
  lines.push(`open_prs: ${data.openPRs.length}`);
  lines.push(`generated_at: ${data.generatedAt}`);
  lines.push('---');
  lines.push('');

  lines.push(`# Daily Progress Report — ${data.longDate}`);
  lines.push('');
  lines.push(
    'Auto-generated by `tools/daily-report.ts`. The orchestrator is welcome ' +
      'to append prose below; subsequent runs of this script will append ' +
      'rather than overwrite.',
  );
  lines.push('');

  // ---- Headline numbers
  lines.push('## Headline numbers');
  lines.push('');
  lines.push(`- **${data.commits.length} commits** on ${data.date} (UTC).`);
  if (data.commitTypeCounts.length > 0) {
    const breakdown = data.commitTypeCounts
      .map((c) => `${c.count}× \`${c.type}\``)
      .join(', ');
    lines.push(`- Conventional Commit mix: ${breakdown}.`);
  } else {
    lines.push('- No Conventional Commit prefixes detected today.');
  }
  lines.push(
    `- Workspace: **${data.apps.length} apps**, **${data.packages.length} packages**.`,
  );
  if (data.testSummary) {
    lines.push(`- \`pnpm test\` tail: \`${flattenForBullet(data.testSummary)}\`.`);
  }
  lines.push(`- Open pull requests: **${data.openPRs.length}**.`);
  lines.push('');

  // ---- Commits
  lines.push('## Commits');
  lines.push('');
  if (data.commits.length === 0) {
    lines.push('_No commits landed during this UTC day._');
  } else {
    for (const c of data.commits) {
      lines.push(`- \`${c.hash}\` ${c.subject}`);
    }
  }
  lines.push('');

  // ---- Test counts
  lines.push('## Test summary');
  lines.push('');
  if (data.testSummary) {
    lines.push('```');
    lines.push(data.testSummary);
    lines.push('```');
  } else {
    lines.push('_Test runner output unavailable for this run._');
  }
  lines.push('');

  // ---- Open PRs
  lines.push('## Open pull requests');
  lines.push('');
  if (data.openPRs.length === 0) {
    lines.push('_No open pull requests, or `gh` CLI not installed._');
  } else {
    for (const pr of data.openPRs) {
      lines.push(`- #${pr.number} ${pr.title} _(${pr.state}, opened ${pr.createdAt})_`);
    }
  }
  lines.push('');

  // ---- Service ports
  lines.push('## What\'s running locally right now');
  lines.push('');
  lines.push('```');
  for (const app of data.apps) {
    const port = app.port ? `:${app.port}`.padEnd(7) : '       ';
    const desc = app.description ? `— ${app.description}` : '';
    lines.push(`${port}apps/${app.dir.padEnd(22)} ${desc}`.trimEnd());
  }
  lines.push('```');
  lines.push('');

  // ---- Workspace packages
  lines.push('## Shared packages');
  lines.push('');
  if (data.packages.length === 0) {
    lines.push('_No shared packages._');
  } else {
    for (const pkg of data.packages) {
      const desc = pkg.description ? ` — ${pkg.description}` : '';
      lines.push(`- \`${pkg.name}\` (\`packages/${pkg.dir}\`)${desc}`);
    }
  }
  lines.push('');

  // ---- Warnings
  if (data.warnings.length > 0) {
    lines.push('## Notes from the generator');
    lines.push('');
    for (const w of data.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function flattenForBullet(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// File output (idempotent: overwrite-safe with append semantics)
// ---------------------------------------------------------------------------

export interface AppendOptions {
  generatedAt: string;
  rendered: string;
}

/**
 * If `existing` is undefined, return `rendered`.
 * Otherwise return `existing` + an append section containing `rendered`.
 */
export function buildOutput(
  existing: string | undefined,
  opts: AppendOptions,
): string {
  if (existing === undefined) {
    return ensureTrailingNewline(opts.rendered);
  }
  const time = opts.generatedAt.slice(11, 16); // HH:MM
  const sep = ensureTrailingNewline(existing);
  return (
    sep +
    '\n' +
    `## Update appended at ${time} UTC\n\n` +
    `Re-ran \`tools/daily-report.ts\` at ${opts.generatedAt}.\n\n` +
    stripFrontMatter(opts.rendered).trimEnd() +
    '\n'
  );
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith('\n') ? s : `${s}\n`;
}

function stripFrontMatter(s: string): string {
  if (!s.startsWith('---')) return s;
  const end = s.indexOf('\n---', 3);
  if (end < 0) return s;
  // skip past the closing --- and following newline
  const rest = s.slice(end + 4);
  return rest.startsWith('\n') ? rest.slice(1) : rest;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface MainDeps {
  argv: string[];
  now: Date;
  cwd: string;
  read: (path: string) => string | undefined;
  write: (path: string, content: string) => void;
  log: (line: string) => void;
  gather: (
    repoRoot: string,
    isoDate: string,
    skipTests: boolean,
  ) => Promise<Omit<ReportData, 'date' | 'longDate' | 'generatedAt'>>;
}

export async function runMain(deps: MainDeps): Promise<number> {
  const today = todayUtcIso(deps.now);
  const here = fileURLToPath(new URL('.', import.meta.url));
  const defaultRoot = findRepoRoot(deps.cwd || here);
  const args = parseArgs(deps.argv, today, defaultRoot);

  const repoRoot = args.repoRoot;
  const sessionsDir = join(repoRoot, 'sessions', 'daily');
  const outPath = join(sessionsDir, `${args.date}.md`);

  const gathered = await deps.gather(repoRoot, args.date, args.skipTests);
  const data: ReportData = {
    ...gathered,
    date: args.date,
    longDate: formatLongDate(args.date),
    generatedAt: deps.now.toISOString(),
  };
  const rendered = renderReport(data);

  if (args.dryRun) {
    deps.log(rendered);
    return 0;
  }

  const existing = deps.read(outPath);
  const output = buildOutput(existing, { generatedAt: data.generatedAt, rendered });
  deps.write(outPath, output);
  deps.log(`Wrote ${outPath}`);
  return 0;
}

async function defaultGather(
  repoRoot: string,
  isoDate: string,
  skipTests: boolean,
): Promise<Omit<ReportData, 'date' | 'longDate' | 'generatedAt'>> {
  const warnings: string[] = [];
  const commits = readGitLog(repoRoot, isoDate);
  const commitTypeCounts = summariseCommitTypes(commits);
  const { apps, packages } = readWorkspace(repoRoot);
  const testSummary = skipTests ? null : runTestSummary(repoRoot, warnings);
  const openPRs = listOpenPRs(repoRoot, warnings);
  return { commits, commitTypeCounts, apps, packages, testSummary, openPRs, warnings };
}

// Top-level invocation guard (only run when executed directly).
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  void runMain({
    argv: process.argv.slice(2),
    now: new Date(),
    cwd: process.cwd(),
    read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined),
    write: (p, c) => {
      const parent = dirname(p);
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
      }
      writeFileSync(p, c);
    },
    log: (line) => {
      // eslint-disable-next-line no-console
      console.log(line);
    },
    gather: defaultGather,
  })
    .then((code) => process.exit(code))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
