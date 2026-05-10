/**
 * vtorn-triage CLI.
 *
 * Usage:
 *   vtorn-triage --pr <num> [--repo owner/name] [--dry-run] [--no-post]
 *
 * Run from a checked-out repo with `gh` authenticated. Default repo
 * is `0800tim/vtorn`.
 *
 * Exit codes:
 *   0  always (the verdict is communicated via the comment + labels;
 *      blocking is handled by the `pr-security.yml` workflow).
 *   2  invalid arguments / setup error.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { GithubAdapter } from './lib/github.js';
import {
  scanNetworkHosts,
  scanEnvVars,
  scanNewDeps,
  scanPromptInjection,
} from './lib/diff-scan.js';
import { loadHostAllowlist, loadKnownEnvVars } from './lib/env-allowlist.js';
import { renderComment } from './lib/comment.js';
import { triage } from './lib/triage.js';
import type { TriageInput } from './lib/types.js';

interface Args {
  pr: number;
  repo: string;
  dryRun: boolean;
  noPost: boolean;
  noLabel: boolean;
  noReviewers: boolean;
  externalFlagsPath?: string;
  outJson?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    pr: NaN,
    repo: process.env.GITHUB_REPOSITORY ?? '0800tim/vtorn',
    dryRun: false,
    noPost: false,
    noLabel: false,
    noReviewers: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--pr':
        out.pr = Number(argv[++i]);
        break;
      case '--repo':
        out.repo = String(argv[++i]);
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--no-post':
        out.noPost = true;
        break;
      case '--no-label':
        out.noLabel = true;
        break;
      case '--no-reviewers':
        out.noReviewers = true;
        break;
      case '--external-flags':
        out.externalFlagsPath = String(argv[++i]);
        break;
      case '--out-json':
        out.outJson = String(argv[++i]);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (a?.startsWith('--')) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  if (!Number.isFinite(out.pr) || out.pr <= 0) {
    console.error('--pr <number> is required');
    process.exit(2);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(out.repo)) {
    console.error(`--repo must be owner/name, got: ${out.repo}`);
    process.exit(2);
  }
  return out;
}

function printHelp(): void {
  console.log(`vtorn-triage — autonomous PR triage runner

USAGE
  vtorn-triage --pr <number> [options]

OPTIONS
  --repo <owner/name>     Default: $GITHUB_REPOSITORY or 0800tim/vtorn
  --dry-run               Comment is prefixed [DRY-RUN]; CI is not blocked
  --no-post               Print verdict JSON to stdout; do not comment
  --no-label              Skip label application
  --no-reviewers          Skip reviewer requests
  --external-flags <p>    Path to a JSON array of pre-collected scanner
                          flags (gitleaks/OSV/semgrep) shaped per FlagSchema
  --out-json <path>       Write the full verdict JSON to <path>
  --help, -h              This help
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();

  const gh = new GithubAdapter({ repo: args.repo });
  const pr = await gh.getPR(args.pr);
  const files = await gh.listFiles(args.pr);

  const knownEnv = loadKnownEnvVars(join(repoRoot, '.env.example'));
  const hostAllow = loadHostAllowlist(join(repoRoot, '.github/security/network-allowlist.txt'));

  const networkHosts = scanNetworkHosts(files, hostAllow);
  const newEnvVars = scanEnvVars(files, knownEnv);
  const newDeps = scanNewDeps(files);
  const promptHits = scanPromptInjection(files);

  let externalFlags: TriageInput['externalFlags'] = [];
  if (args.externalFlagsPath) {
    if (!existsSync(args.externalFlagsPath)) {
      console.warn(`external-flags file not found: ${args.externalFlagsPath}`);
    } else {
      try {
        externalFlags = JSON.parse(readFileSync(args.externalFlagsPath, 'utf-8'));
      } catch (e) {
        console.warn(`failed to parse external-flags: ${(e as Error).message}`);
      }
    }
  }

  const input: TriageInput = {
    pr: {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      author: pr.author,
      authorAssociation: pr.authorAssociation as TriageInput['pr']['authorAssociation'],
      baseRef: pr.baseRef,
      headSha: pr.headRefOid,
      draft: pr.isDraft,
    },
    files,
    networkHosts,
    newEnvVars,
    newDeps,
    externalFlags,
    promptInjectionHits: promptHits,
  };

  const verdict = triage(input, { dryRun: args.dryRun });

  if (args.outJson) {
    const fs = await import('node:fs');
    fs.writeFileSync(args.outJson, JSON.stringify(verdict, null, 2), 'utf-8');
  }

  if (args.noPost) {
    console.log(JSON.stringify(verdict, null, 2));
    return;
  }

  const body = renderComment(verdict);
  await gh.upsertComment(args.pr, verdict.marker, body);
  if (!args.noLabel) {
    await gh.applyLabels(args.pr, verdict.labels);
  }
  if (!args.noReviewers) {
    await gh.requestReviewers(args.pr, verdict.reviewers);
  }

  console.log(
    JSON.stringify(
      {
        pr: verdict.prNumber,
        verdict: verdict.verdict,
        riskScore: verdict.riskScore,
        flags: verdict.flags.length,
        labels: verdict.labels,
        reviewers: verdict.reviewers,
        dryRun: verdict.dryRun,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(`vtorn-triage failed: ${(err as Error).message}`);
  process.exit(2);
});
