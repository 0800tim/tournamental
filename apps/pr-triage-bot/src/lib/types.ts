/**
 * Shared types for the PR triage bot.
 *
 * The triage bot ingests untrusted data (PR titles, descriptions,
 * commit messages, diff contents) and produces a structured verdict
 * that gets posted as a comment on the PR. Every string surface here
 * MUST be treated as data — never interpolated into shell commands,
 * eval()'d, or used to drive control flow.
 */

import { z } from 'zod';

/**
 * Top-level verdict for a PR.
 *
 *   - green:  no flags, can be reviewed normally
 *   - yellow: flags worth a human's attention but not blockers
 *   - red:    blocking flags requiring a security or codeowner review
 */
export const VerdictSchema = z.enum(['green', 'yellow', 'red']);
export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * A single flag raised by one of the deterministic scanners.
 *
 *   - id: stable kebab-case key used for de-dupe and dashboard filters
 *   - severity: drives the verdict roll-up
 *   - score: contribution to the 0-100 risk score
 *   - title: short human-readable summary (no PR-content interpolation)
 *   - detail: optional longer text, also untrusted-safe
 *   - source: which scanner produced the flag (for traceability)
 */
export const FlagSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  score: z.number().int().min(0).max(100),
  title: z.string().min(1).max(160),
  detail: z.string().max(2000).optional(),
  source: z.enum([
    'classifier',
    'gitleaks',
    'osv-scanner',
    'semgrep',
    'license-audit',
    'network-allowlist',
    'bundle-size',
    'secret-scope',
    'prompt-injection',
    'codeowners',
    'dco',
    'first-time-contributor',
  ]),
});
export type Flag = z.infer<typeof FlagSchema>;

/**
 * Structured inputs the triage-bot consumes.
 *
 * All PR-derived strings are required but explicitly marked untrusted
 * by callers. See README "Treating PR content as data" for rules.
 */
export const TriageInputSchema = z.object({
  pr: z.object({
    number: z.number().int().positive(),
    title: z.string().max(500),
    body: z.string().max(10_000).default(''),
    author: z.string().min(1).max(100),
    authorAssociation: z
      .enum([
        'OWNER',
        'MEMBER',
        'COLLABORATOR',
        'CONTRIBUTOR',
        'FIRST_TIME_CONTRIBUTOR',
        'FIRST_TIMER',
        'NONE',
      ])
      .default('NONE'),
    baseRef: z.string(),
    headSha: z.string().regex(/^[0-9a-f]{7,40}$/),
    draft: z.boolean().default(false),
  }),
  files: z
    .array(
      z.object({
        path: z.string(),
        status: z.enum(['added', 'modified', 'removed', 'renamed']),
        additions: z.number().int().min(0),
        deletions: z.number().int().min(0),
        // Patch is optional and bounded — we never inline it into output.
        patch: z.string().max(200_000).optional(),
      }),
    )
    .max(2000),
  /** Hosts referenced in newly added or modified network calls. */
  networkHosts: z.array(z.string().max(255)).default([]),
  /** Newly added env-var reads via process.env. */
  newEnvVars: z.array(z.string().max(100)).default([]),
  /** Newly added dependencies. */
  newDeps: z
    .array(
      z.object({
        name: z.string().max(214),
        version: z.string().max(64),
        ecosystem: z.enum(['npm', 'pip', 'github-actions']),
      }),
    )
    .default([]),
  /** Pre-collected flags from external scanners (gitleaks, OSV, semgrep). */
  externalFlags: z.array(FlagSchema).default([]),
  /** Output of the prompt-injection canary scan. */
  promptInjectionHits: z.array(z.string().max(200)).default([]),
});
export type TriageInput = z.infer<typeof TriageInputSchema>;

/**
 * The bot's structured output. Posted as a JSON artifact AND
 * rendered into the PR comment.
 */
export const TriageVerdictSchema = z.object({
  prNumber: z.number().int().positive(),
  headSha: z.string(),
  verdict: VerdictSchema,
  riskScore: z.number().int().min(0).max(100),
  generatedAt: z.string(),
  flags: z.array(FlagSchema),
  labels: z.array(z.string()).max(20),
  reviewers: z.array(z.string()).max(10),
  // Counts for the summary block
  summary: z.object({
    filesChanged: z.number().int().min(0),
    linesAdded: z.number().int().min(0),
    linesRemoved: z.number().int().min(0),
    appsTouched: z.array(z.string()).max(50),
    newDepsCount: z.number().int().min(0),
    newHostsCount: z.number().int().min(0),
  }),
  /**
   * Marker used to find and update existing comments idempotently.
   * Format: `<!-- vtorn-triage-bot:rev:<sha> -->`.
   */
  marker: z.string(),
  /**
   * When true, the bot will NOT block CI — used during the soft-launch
   * window. The PR comment is prefixed `[DRY-RUN]`.
   */
  dryRun: z.boolean().default(false),
});
export type TriageVerdict = z.infer<typeof TriageVerdictSchema>;
