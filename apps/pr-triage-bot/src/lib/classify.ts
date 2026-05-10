/**
 * Path-based classifier.
 *
 * Maps changed file paths to:
 *   - the workspace app(s) touched (e.g. `apps/web`)
 *   - the topic labels that should be applied (`area:renderer`, etc.)
 *   - sensitivity tags used by the scoring engine
 *
 * Sensitive zones (auth, identity, payments, signing, smart contracts)
 * exist at well-known paths. A change inside these contributes a higher
 * base risk score and forces a human security reviewer.
 *
 * No PR text is consulted here — only the canonical file paths.
 */

const APP_PREFIX = /^apps\/([a-z0-9][a-z0-9-]*)\//;
const PKG_PREFIX = /^packages\/([a-z0-9][a-z0-9-]*)\//;

/**
 * Paths that get the highest sensitivity tag. Any change in these
 * pushes the PR toward yellow/red and pulls in a security reviewer.
 */
const SENSITIVE_APP_PATHS = [
  'apps/auth-sms/',
  'apps/identity/',
  'apps/dm-otp/',
  'apps/vstamp/',
  'apps/drips-bridge/',
];

const SENSITIVE_FILES = [
  /^\.github\/workflows\//,
  /^\.github\/CODEOWNERS$/,
  /^SECURITY\.md$/,
  /^CONTRIBUTING\.md$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^infra\/docker\//,
  /^infra\/scripts\//,
];

/**
 * Path → topic label. Order matters; the first match wins.
 */
const AREA_LABELS: { match: RegExp; label: string }[] = [
  { match: /^apps\/web\/components\/replay\//, label: 'area:renderer' },
  { match: /^apps\/web\/components\/overlay\//, label: 'area:overlay' },
  { match: /^apps\/web\/components\/match-pick\//, label: 'area:match-pick' },
  { match: /^apps\/web\//, label: 'area:web' },
  { match: /^apps\/marketing\//, label: 'area:marketing' },
  { match: /^apps\/admin\//, label: 'area:admin' },
  { match: /^apps\/api\//, label: 'area:api' },
  { match: /^apps\/auth-sms\//, label: 'area:auth' },
  { match: /^apps\/identity\//, label: 'area:identity' },
  { match: /^apps\/dm-otp\//, label: 'area:dm-otp' },
  { match: /^apps\/vstamp\//, label: 'area:vstamp' },
  { match: /^apps\/drips-bridge\//, label: 'area:drips' },
  { match: /^apps\/game\//, label: 'area:game' },
  { match: /^apps\/affiliate-router\//, label: 'area:affiliate' },
  { match: /^apps\/clip-pipeline\//, label: 'area:clips' },
  { match: /^apps\/odds-ingest\//, label: 'area:odds' },
  { match: /^apps\/statsbomb-replay\//, label: 'area:replay' },
  { match: /^apps\/wc2026/, label: 'area:wc2026' },
  { match: /^apps\/stream-server\//, label: 'area:stream' },
  { match: /^apps\/mock-producer\//, label: 'area:mock' },
  { match: /^apps\/tournament-bot\//, label: 'area:bot' },
  { match: /^apps\/native\//, label: 'area:native' },
  { match: /^apps\/social-publisher\//, label: 'area:social' },
  { match: /^apps\/push-notifications\//, label: 'area:push' },
  { match: /^apps\/crm-bridge\//, label: 'area:crm' },
  { match: /^apps\/dm-poll-forwarder\//, label: 'area:dm-poll' },
  { match: /^apps\/pr-triage-bot\//, label: 'area:meta' },
  { match: /^apps\/security-watchdog\//, label: 'area:meta' },
  { match: /^packages\/spec\//, label: 'area:spec' },
  { match: /^packages\//, label: 'area:packages' },
  { match: /^docs\//, label: 'area:docs' },
  { match: /^\.github\//, label: 'area:ci' },
  { match: /^infra\//, label: 'area:infra' },
  { match: /^sessions\//, label: 'area:sessions' },
  { match: /^config\//, label: 'area:config' },
];

export interface Classification {
  /** Apps and packages touched (e.g. `apps/web`, `packages/spec`). */
  workspaces: string[];
  /** Unique topic labels inferred from the diff. */
  areaLabels: string[];
  /** True when any sensitive path is touched. */
  touchesSensitive: boolean;
  /** Specific sensitive markers (for the triage comment). */
  sensitiveReasons: string[];
  /** True when a CI workflow file changes. */
  touchesWorkflow: boolean;
  /** True when root manifests change. */
  touchesRootManifest: boolean;
}

export function classifyPaths(paths: readonly string[]): Classification {
  const workspaces = new Set<string>();
  const areaLabels = new Set<string>();
  const sensitiveReasons = new Set<string>();
  let touchesWorkflow = false;
  let touchesRootManifest = false;

  for (const p of paths) {
    const am = p.match(APP_PREFIX);
    if (am) workspaces.add(`apps/${am[1]}`);
    const pm = p.match(PKG_PREFIX);
    if (pm) workspaces.add(`packages/${pm[1]}`);

    for (const { match, label } of AREA_LABELS) {
      if (match.test(p)) {
        areaLabels.add(label);
        break;
      }
    }

    for (const sp of SENSITIVE_APP_PATHS) {
      if (p.startsWith(sp)) {
        sensitiveReasons.add(sp.replace(/\/$/, ''));
      }
    }
    for (const sf of SENSITIVE_FILES) {
      if (sf.test(p)) {
        sensitiveReasons.add(p);
        if (/^\.github\/workflows\//.test(p)) touchesWorkflow = true;
        if (p === 'package.json' || p === 'pnpm-lock.yaml') touchesRootManifest = true;
      }
    }
  }

  return {
    workspaces: [...workspaces].sort(),
    areaLabels: [...areaLabels].sort(),
    touchesSensitive: sensitiveReasons.size > 0,
    sensitiveReasons: [...sensitiveReasons].sort(),
    touchesWorkflow,
    touchesRootManifest,
  };
}
