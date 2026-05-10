/**
 * Risk-scoring engine.
 *
 * Inputs come from:
 *   - the path classifier ({@link classifyPaths})
 *   - the deterministic scanners (gitleaks, OSV, semgrep, etc.) collected
 *     into TriageInput.externalFlags
 *   - lightweight repo signals (new deps, new env vars, new network hosts,
 *     prompt-injection canary hits)
 *
 * Output:
 *   - a list of {@link Flag}s with stable IDs
 *   - a 0-100 risk score (sum of flag scores, capped at 100)
 *   - a roll-up verdict (green/yellow/red)
 *
 * The function is pure and deterministic so the test suite can pin every
 * boundary case. No PR-derived strings are used in control flow — only
 * structural facts (path prefixes, dep counts, host counts, severity tags).
 */

import type { Classification } from './classify.js';
import type { Flag, TriageInput, Verdict } from './types.js';

export interface ScoreResult {
  flags: Flag[];
  riskScore: number;
  verdict: Verdict;
}

/**
 * Map a flag severity to its verdict-roll-up rank. Higher is worse.
 */
const SEVERITY_RANK: Record<Flag['severity'], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Verdict thresholds. Tunable via constants so the test suite locks them.
 */
export const SCORE_THRESHOLDS = {
  yellow: 25,
  red: 60,
} as const;

/**
 * Severity-to-verdict floor. Even a low-score "high" finding forces yellow;
 * any "critical" forces red.
 */
function verdictFromSeverity(maxRank: number): Verdict {
  if (maxRank >= SEVERITY_RANK.critical) return 'red';
  if (maxRank >= SEVERITY_RANK.high) return 'red';
  if (maxRank >= SEVERITY_RANK.medium) return 'yellow';
  return 'green';
}

function verdictFromScore(score: number): Verdict {
  if (score >= SCORE_THRESHOLDS.red) return 'red';
  if (score >= SCORE_THRESHOLDS.yellow) return 'yellow';
  return 'green';
}

function rollUpVerdict(score: number, maxSeverityRank: number): Verdict {
  // Whichever lever is more pessimistic wins.
  const a = verdictFromScore(score);
  const b = verdictFromSeverity(maxSeverityRank);
  const rank = (v: Verdict) => (v === 'red' ? 2 : v === 'yellow' ? 1 : 0);
  return rank(a) >= rank(b) ? a : b;
}

export function scorePR(input: TriageInput, cls: Classification): ScoreResult {
  const flags: Flag[] = [];

  // 1. Classifier-driven flags
  if (cls.touchesSensitive) {
    flags.push({
      id: 'sensitive-zone',
      severity: 'high',
      score: 40,
      title: `Touches sensitive zone (${cls.sensitiveReasons.length} path${
        cls.sensitiveReasons.length === 1 ? '' : 's'
      })`,
      detail: `Sensitive paths changed: ${cls.sensitiveReasons.join(', ')}`,
      source: 'classifier',
    });
  }
  if (cls.touchesWorkflow) {
    flags.push({
      id: 'ci-workflow-change',
      severity: 'medium',
      score: 20,
      title: 'Modifies a GitHub Actions workflow',
      detail:
        'Workflow changes can affect every future PR — confirm scope and that secrets/permissions are not widened.',
      source: 'classifier',
    });
  }
  if (cls.touchesRootManifest && input.pr.authorAssociation === 'FIRST_TIME_CONTRIBUTOR') {
    flags.push({
      id: 'first-timer-root-manifest',
      severity: 'high',
      score: 50,
      title: 'First-time contributor modifies root package.json or lockfile',
      detail:
        'New contributors editing the root manifest is a known supply-chain attack pattern. Hand-review every dep diff.',
      source: 'first-time-contributor',
    });
  }

  // 2. Dependency / network / env signals
  if (input.newDeps.length > 0) {
    flags.push({
      id: 'new-deps',
      severity: input.newDeps.length >= 3 ? 'medium' : 'low',
      score: Math.min(50, 25 + (input.newDeps.length - 1) * 5),
      title: `${input.newDeps.length} new dependenc${input.newDeps.length === 1 ? 'y' : 'ies'}`,
      detail: input.newDeps
        .slice(0, 20)
        .map((d) => `- ${d.ecosystem}: ${d.name}@${d.version}`)
        .join('\n'),
      source: 'classifier',
    });
  }
  if (input.networkHosts.length > 0) {
    flags.push({
      id: 'new-network-hosts',
      severity: 'medium',
      score: Math.min(40, 30 + input.networkHosts.length * 2),
      title: `${input.networkHosts.length} new third-party network call host${
        input.networkHosts.length === 1 ? '' : 's'
      }`,
      detail: input.networkHosts.slice(0, 30).map((h) => `- ${h}`).join('\n'),
      source: 'network-allowlist',
    });
  }
  if (input.newEnvVars.length > 0) {
    flags.push({
      id: 'new-env-vars',
      severity: 'low',
      score: 10,
      title: `${input.newEnvVars.length} new env var read${input.newEnvVars.length === 1 ? '' : 's'}`,
      detail: input.newEnvVars.slice(0, 30).map((e) => `- ${e}`).join('\n'),
      source: 'secret-scope',
    });
  }
  if (input.promptInjectionHits.length > 0) {
    flags.push({
      id: 'prompt-injection-canary',
      severity: 'high',
      score: 60,
      title: `Prompt-injection canary triggered (${input.promptInjectionHits.length} pattern hit${
        input.promptInjectionHits.length === 1 ? '' : 's'
      })`,
      detail:
        'A prompt-injection pattern was found in newly added prompt or content files. ' +
        'Review whether the wording is intentional and whether it can subvert downstream LLM agents.',
      source: 'prompt-injection',
    });
  }

  // 3. External scanner findings — pass through, but rebuild ID with prefix
  for (const ext of input.externalFlags) {
    flags.push({ ...ext, id: ext.id });
  }

  // 4. Roll up
  const rawScore = flags.reduce((acc, f) => acc + f.score, 0);
  const score = Math.min(100, rawScore);
  const maxSeverity = flags.reduce((m, f) => Math.max(m, SEVERITY_RANK[f.severity]), 0);
  const verdict = rollUpVerdict(score, maxSeverity);

  return { flags, riskScore: score, verdict };
}
