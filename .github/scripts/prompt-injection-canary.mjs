#!/usr/bin/env node
/**
 * Prompt-injection canary.
 *
 * Walks the diff for added lines in prompt files (config/prompts/,
 * apps/* /prompts/, prompts/, *.md, *.mdx) and flags well-known
 * prompt-injection patterns (`ignore previous instructions`,
 * `disregard`, role overrides, long base64 blobs, etc.).
 *
 * Output: JSON
 *   {
 *     ok: true,            // canary never fails CI; advisory only
 *     hits: [{ pattern, file, line }]
 *   }
 *
 * The triage bot consumes this artifact and labels accordingly.
 */

import { execSync } from 'node:child_process';

const PATTERNS = [
  { id: 'ignore-previous-instructions', re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i },
  { id: 'disregard', re: /disregard\s+(all\s+)?(previous|prior|above)/i },
  { id: 'system-prompt-leak', re: /(reveal|print|show|output)\s+(your\s+)?(system|hidden|secret)\s+prompt/i },
  { id: 'role-override', re: /you\s+are\s+now\s+(a|an|the)\s+/i },
  { id: 'jailbreak-prefix', re: /\b(do anything now|DAN mode|developer mode)\b/i },
  { id: 'tool-spoof', re: /<<<\s*system\s*>>>|\[SYSTEM\]:|<\|im_start\|>system/i },
  { id: 'data-exfil', re: /(send|post|upload|exfiltrate)\s+(the\s+)?(secrets|credentials|tokens|api[\s-]?keys?)/i },
  { id: 'long-base64', re: /[A-Za-z0-9+/]{200,}={0,2}/ },
];

const PROMPT_FILE = /^(config\/prompts\/|apps\/[^/]+\/prompts\/|prompts\/|.+\.mdx?$)/;

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf-8' });
}

function* addedLinesByFile() {
  const base = process.env.GITHUB_BASE_REF
    ? `origin/${process.env.GITHUB_BASE_REF}`
    : 'origin/main';
  try {
    git('fetch origin --depth=1');
  } catch {
    /* ignore */
  }
  let diff;
  try {
    diff = git(`diff --unified=0 ${base}...HEAD`);
  } catch {
    diff = git('diff --unified=0 HEAD');
  }
  let path = '';
  let lineNo = 0;
  for (const raw of diff.split('\n')) {
    const fm = raw.match(/^diff --git a\/(\S+)/);
    if (fm) {
      path = fm[1];
      continue;
    }
    const hm = raw.match(/^@@ .* \+(\d+)/);
    if (hm) {
      lineNo = Number(hm[1]);
      continue;
    }
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    yield { path, line: lineNo, content: raw.slice(1) };
    lineNo += 1;
  }
}

const hits = [];
for (const { path, line, content } of addedLinesByFile()) {
  if (!PROMPT_FILE.test(path)) continue;
  for (const p of PATTERNS) {
    if (p.re.test(content)) hits.push({ pattern: p.id, file: path, line });
  }
}

const out = { ok: true, hits };
process.stdout.write(JSON.stringify(out, null, 2));
