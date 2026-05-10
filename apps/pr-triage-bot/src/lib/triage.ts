/**
 * Top-level triage routine.
 *
 *   triage(input) -> TriageVerdict
 *
 * Combines the path classifier, the score engine, and the label/reviewer
 * resolver into a single pure function. No I/O — callers (CLI, Fastify)
 * do the GitHub round-trips and pass results in.
 */

import { classifyPaths } from './classify.js';
import { buildMarker } from './comment.js';
import { scorePR } from './score.js';
import { type TriageInput, TriageInputSchema, type TriageVerdict } from './types.js';

const REVIEWER_FOR_AREA: Record<string, string[]> = {
  'area:auth': ['0800tim'],
  'area:identity': ['0800tim'],
  'area:dm-otp': ['0800tim'],
  'area:vstamp': ['0800tim'],
  'area:drips': ['0800tim'],
  'area:ci': ['0800tim'],
  'area:spec': ['0800tim'],
};

export interface TriageOptions {
  /** When true, produce a verdict but do NOT block CI — comment prefixed [DRY-RUN]. */
  dryRun?: boolean;
  /** Override generatedAt for deterministic tests. */
  now?: Date;
}

export function triage(rawInput: unknown, opts: TriageOptions = {}): TriageVerdict {
  // Validate inputs strictly. Anything that fails the schema is rejected
  // here BEFORE any string ever lands in a comment or shell command.
  const input: TriageInput = TriageInputSchema.parse(rawInput);

  const paths = input.files.map((f) => f.path);
  const cls = classifyPaths(paths);
  const { flags, riskScore, verdict } = scorePR(input, cls);

  // Roll up summary
  const filesChanged = input.files.length;
  const linesAdded = input.files.reduce((s, f) => s + f.additions, 0);
  const linesRemoved = input.files.reduce((s, f) => s + f.deletions, 0);

  // Labels: verdict + areas + meta
  const labels = new Set<string>();
  labels.add(`auto-triage:${verdict}`);
  for (const a of cls.areaLabels) labels.add(a);
  if (input.newDeps.length > 0) labels.add('deps');
  if (cls.touchesWorkflow) labels.add('ci');
  if (input.promptInjectionHits.length > 0) labels.add('security:prompt-injection');
  if (cls.touchesSensitive) labels.add('security:sensitive-zone');

  // Reviewers: only on yellow/red, derived from area labels
  const reviewers = new Set<string>();
  if (verdict !== 'green') {
    for (const lbl of cls.areaLabels) {
      const list = REVIEWER_FOR_AREA[lbl];
      if (list) for (const r of list) reviewers.add(r);
    }
    // Always add the security on-call for red
    if (verdict === 'red') reviewers.add('0800tim');
  }
  // Never request the PR author as a reviewer.
  reviewers.delete(input.pr.author);

  const generatedAt = (opts.now ?? new Date()).toISOString();
  const marker = buildMarker(input.pr.headSha);

  return {
    prNumber: input.pr.number,
    headSha: input.pr.headSha,
    verdict,
    riskScore,
    generatedAt,
    flags,
    labels: [...labels].sort(),
    reviewers: [...reviewers].sort(),
    summary: {
      filesChanged,
      linesAdded,
      linesRemoved,
      appsTouched: cls.workspaces,
      newDepsCount: input.newDeps.length,
      newHostsCount: input.networkHosts.length,
    },
    marker,
    dryRun: opts.dryRun ?? false,
  };
}
