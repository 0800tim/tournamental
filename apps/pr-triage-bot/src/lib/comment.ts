/**
 * Markdown rendering of the triage verdict.
 *
 * SECURITY: every PR-derived string is escaped before it lands in the
 * comment. We never echo raw author input. The body is built by string
 * concat from internal, validated fields only — no template literal
 * injection paths, no HTML, no Markdown that could execute downstream.
 */

import type { Flag, TriageVerdict } from './types.js';

const VERDICT_BADGE: Record<TriageVerdict['verdict'], string> = {
  green: 'GREEN — auto-triage clear',
  yellow: 'YELLOW — humans please review the flags',
  red: 'RED — security or codeowner review required',
};

const SEVERITY_LABEL: Record<Flag['severity'], string> = {
  info: 'INFO',
  low: 'LOW',
  medium: 'MEDIUM',
  high: 'HIGH',
  critical: 'CRITICAL',
};

/**
 * Strip Markdown control characters to neutralise any text that came
 * from the PR body, commit message, or scanner detail field. Backticks,
 * pipes, asterisks, brackets, and HTML tag-openers are escaped.
 */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/[\\`*_{}\[\]()#+\-!|<>]/g, (ch) => `\\${ch}`)
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 1500);
}

function renderFlag(f: Flag): string {
  const head = `- **${SEVERITY_LABEL[f.severity]}** \`${f.source}\` — ${escapeMarkdown(f.title)}`;
  if (!f.detail) return head;
  const detail = f.detail
    .split('\n')
    .slice(0, 30)
    .map((line) => `    ${escapeMarkdown(line)}`)
    .join('\n');
  return `${head}\n${detail}`;
}

function renderSummary(v: TriageVerdict): string {
  return [
    '| Metric | Value |',
    '| --- | --- |',
    `| Files changed | ${v.summary.filesChanged} |`,
    `| Lines added | ${v.summary.linesAdded} |`,
    `| Lines removed | ${v.summary.linesRemoved} |`,
    `| Apps touched | ${v.summary.appsTouched.length === 0 ? '_none_' : v.summary.appsTouched.map((a) => `\`${a}\``).join(', ')} |`,
    `| New dependencies | ${v.summary.newDepsCount} |`,
    `| New 3rd-party hosts | ${v.summary.newHostsCount} |`,
  ].join('\n');
}

/**
 * Render the full PR comment body. Idempotent — the marker comment lets
 * the runner replace any existing comment for the same head SHA.
 */
export function renderComment(v: TriageVerdict): string {
  const dryPrefix = v.dryRun ? '> :hourglass: **DRY-RUN** — this verdict is informational; CI is not blocked.\n\n' : '';
  const lines: string[] = [];
  lines.push(v.marker);
  lines.push(dryPrefix + `## Auto-triage: ${VERDICT_BADGE[v.verdict]}`);
  lines.push('');
  lines.push(`**Risk score:** ${v.riskScore}/100`);
  lines.push('');
  lines.push(renderSummary(v));
  lines.push('');

  if (v.flags.length === 0) {
    lines.push('No flags raised by the automated scanners. A human reviewer will still take a look.');
  } else {
    lines.push(`### ${v.flags.length} flag${v.flags.length === 1 ? '' : 's'}`);
    lines.push('');
    for (const f of v.flags) {
      lines.push(renderFlag(f));
    }
  }

  lines.push('');
  if (v.labels.length > 0) {
    lines.push(`**Labels applied:** ${v.labels.map((l) => `\`${l}\``).join(', ')}`);
  }
  if (v.reviewers.length > 0) {
    lines.push(`**Reviewers requested:** ${v.reviewers.map((r) => `@${r}`).join(', ')}`);
  }
  lines.push('');
  lines.push(
    '<sub>Posted by `@vtorn/pr-triage-bot`. ' +
      'How this works: [docs/security/01-pr-triage-process.md](../blob/main/docs/security/01-pr-triage-process.md). ' +
      'Disagree with the verdict? Comment `/triage override <reason>` and a maintainer will re-review.</sub>',
  );
  return lines.join('\n');
}

/**
 * Build the idempotency marker for a given head SHA. The PR-triage bot
 * looks for this marker on existing comments and updates in place.
 */
export function buildMarker(headSha: string): string {
  // SHA is validated upstream against /^[0-9a-f]{7,40}$/ — safe to inline.
  return `<!-- vtorn-triage-bot:rev:${headSha} -->`;
}
