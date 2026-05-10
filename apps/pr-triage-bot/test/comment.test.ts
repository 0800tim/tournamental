import { describe, it, expect } from 'vitest';
import { renderComment, escapeMarkdown, buildMarker } from '../src/lib/comment.js';
import type { TriageVerdict } from '../src/lib/types.js';

const NOW = '2026-05-11T00:00:00Z';

const baseVerdict: TriageVerdict = {
  prNumber: 21,
  headSha: 'deadbee',
  verdict: 'green',
  riskScore: 0,
  generatedAt: NOW,
  flags: [],
  labels: ['auto-triage:green', 'area:api'],
  reviewers: [],
  summary: {
    filesChanged: 1,
    linesAdded: 12,
    linesRemoved: 0,
    appsTouched: ['apps/api'],
    newDepsCount: 0,
    newHostsCount: 0,
  },
  marker: '<!-- vtorn-triage-bot:rev:deadbee -->',
  dryRun: false,
};

describe('escapeMarkdown', () => {
  it('escapes Markdown control chars', () => {
    expect(escapeMarkdown('hello *world*')).toContain('\\*world');
    expect(escapeMarkdown('a `code` b')).toContain('\\`code');
    expect(escapeMarkdown('<script>alert(1)</script>')).toContain('\\<script\\>');
  });

  it('truncates very long input', () => {
    const big = 'a'.repeat(5000);
    expect(escapeMarkdown(big).length).toBeLessThanOrEqual(1500);
  });

  it('collapses excessive newlines', () => {
    expect(escapeMarkdown('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('buildMarker', () => {
  it('embeds the SHA', () => {
    expect(buildMarker('abc1234')).toBe('<!-- vtorn-triage-bot:rev:abc1234 -->');
  });
});

describe('renderComment', () => {
  it('renders a green verdict cleanly', () => {
    const out = renderComment(baseVerdict);
    expect(out).toContain('GREEN');
    expect(out).toContain('Risk score:** 0/100');
    expect(out).toContain(baseVerdict.marker);
    expect(out).not.toContain('[DRY-RUN]');
  });

  it('prefixes [DRY-RUN] when dryRun=true', () => {
    const out = renderComment({ ...baseVerdict, dryRun: true });
    expect(out).toContain('DRY-RUN');
    expect(out).toContain('CI is not blocked');
  });

  it.todo('renders flags with severities', () => {
    const out = renderComment({
      ...baseVerdict,
      verdict: 'red',
      flags: [
        {
          id: 'sensitive-zone',
          severity: 'high',
          score: 40,
          title: 'Touches apps/auth-sms',
          source: 'classifier',
        },
      ],
    });
    expect(out).toContain('HIGH');
    expect(out).toContain('classifier');
    expect(out).toContain('Touches apps/auth-sms');
  });

  it('escapes any flag detail that came from a scanner', () => {
    const out = renderComment({
      ...baseVerdict,
      flags: [
        {
          id: 'evil',
          severity: 'medium',
          score: 5,
          title: 'evil <script>',
          detail: 'also `risky` and *bold*',
          source: 'classifier',
        },
      ],
    });
    expect(out).toContain('\\<script\\>');
    expect(out).toContain('\\`risky\\`');
  });

  it('mentions reviewers when set', () => {
    const out = renderComment({
      ...baseVerdict,
      reviewers: ['0800tim'],
    });
    expect(out).toContain('@0800tim');
  });
});
