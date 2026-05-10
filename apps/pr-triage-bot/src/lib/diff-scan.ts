/**
 * Diff scanners — pure functions that walk a list of file patches and
 * return structured signals (network hosts, env vars, deps, prompt-
 * injection canary hits).
 *
 * Each scanner only looks at *added* lines (lines starting with `+ `
 * after the @@ hunk header) so we don't flag pre-existing code.
 */

const ADDED_LINE_RE = /^\+(?!\+\+ )(.*)$/;

/**
 * Walk a unified-diff patch and yield only the newly added lines.
 */
function* addedLines(patch: string | undefined): Generator<string> {
  if (!patch) return;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++ ')) continue;
    const m = line.match(ADDED_LINE_RE);
    if (m) yield m[1] ?? '';
  }
}

/**
 * Detect new third-party hostnames referenced in code. We grep for:
 *   - fetch('https://...')
 *   - axios.get('https://...'), axios.post(...)
 *   - got('https://...')
 *   - https.request({ host: '...' })
 *   - new URL('https://...')
 *
 * Returns a deduplicated lowercased host list.
 */
const URL_RE = /(?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?:[\/:?#]|$)/gi;

const ALWAYS_OK_HOSTS = new Set<string>([
  // localhost / loopback
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  // ours
  'tournamental.com',
  'aiva.nz',
  // common docs anchors that show up in comments
  'github.com',
  'tools.ietf.org',
  'datatracker.ietf.org',
  'wikipedia.org',
  'developer.mozilla.org',
]);

export function scanNetworkHosts(
  files: ReadonlyArray<{ path: string; patch?: string }>,
  allowlist: ReadonlySet<string> = new Set(),
): string[] {
  const hosts = new Set<string>();
  for (const f of files) {
    if (!shouldScanForCode(f.path)) continue;
    for (const line of addedLines(f.patch)) {
      // Skip comments to reduce noise — naive but fine for the canary.
      const code = stripComment(line);
      let m: RegExpExecArray | null;
      URL_RE.lastIndex = 0;
      while ((m = URL_RE.exec(code))) {
        const host = (m[1] ?? '').toLowerCase();
        if (!host) continue;
        if (ALWAYS_OK_HOSTS.has(host)) continue;
        if (allowlist.has(host)) continue;
        // Wildcard suffix match: an entry like ".tournamental.com" allows any subdomain
        let allowedBySuffix = false;
        for (const a of allowlist) {
          if (a.startsWith('.') && host.endsWith(a)) {
            allowedBySuffix = true;
            break;
          }
        }
        if (allowedBySuffix) continue;
        hosts.add(host);
      }
    }
  }
  return [...hosts].sort();
}

const ENV_RE = /process\.env\.([A-Z][A-Z0-9_]+)/g;

export function scanEnvVars(
  files: ReadonlyArray<{ path: string; patch?: string }>,
  knownEnvVars: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  for (const f of files) {
    if (!shouldScanForCode(f.path)) continue;
    for (const line of addedLines(f.patch)) {
      const code = stripComment(line);
      let m: RegExpExecArray | null;
      ENV_RE.lastIndex = 0;
      while ((m = ENV_RE.exec(code))) {
        const name = m[1];
        if (!name) continue;
        if (knownEnvVars.has(name)) continue;
        found.add(name);
      }
    }
  }
  return [...found].sort();
}

/**
 * Compare added/modified package.json files vs. their before-state to
 * find newly added deps. We only have the patch text, so we approximate:
 * any added line of form `"<name>": "<version>"` inside a `dependencies`,
 * `devDependencies`, `peerDependencies`, or `optionalDependencies` block.
 */
const DEP_LINE_RE = /^\s*"([@a-z0-9._/-]+)"\s*:\s*"([^"]+)"\s*,?\s*$/i;

export function scanNewDeps(
  files: ReadonlyArray<{ path: string; patch?: string; status: string }>,
): Array<{ name: string; version: string; ecosystem: 'npm' | 'pip' | 'github-actions' }> {
  const out: Array<{ name: string; version: string; ecosystem: 'npm' | 'pip' | 'github-actions' }> = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!/(^|\/)package\.json$/.test(f.path)) continue;
    if (!f.patch) continue;
    let inDepsBlock = false;
    for (const rawLine of f.patch.split('\n')) {
      const trimmed = rawLine.replace(/^[+\- ]/, '');
      if (/"(dependencies|devDependencies|peerDependencies|optionalDependencies)"\s*:\s*\{/.test(trimmed)) {
        inDepsBlock = true;
        continue;
      }
      if (inDepsBlock && /^\s*\}\s*,?\s*$/.test(trimmed)) {
        inDepsBlock = false;
        continue;
      }
      if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;
      if (!inDepsBlock) continue;
      const m = trimmed.match(DEP_LINE_RE);
      if (!m) continue;
      const [, name, version] = m;
      if (!name || !version) continue;
      const key = `npm:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, version, ecosystem: 'npm' });
    }
  }

  // pyproject.toml: added lines like `pkg-name = "1.2.3"`
  const PY_LINE_RE = /^\s*([a-z0-9][a-z0-9._-]+)\s*=\s*"([^"]+)"\s*$/i;
  for (const f of files) {
    if (!/(^|\/)pyproject\.toml$/.test(f.path)) continue;
    if (!f.patch) continue;
    let inDeps = false;
    for (const rawLine of f.patch.split('\n')) {
      const trimmed = rawLine.replace(/^[+\- ]/, '');
      if (/^\s*\[(project\.dependencies|tool\.poetry\.dependencies|dependencies)\]\s*$/.test(trimmed)) {
        inDeps = true;
        continue;
      }
      if (inDeps && /^\s*\[/.test(trimmed)) {
        inDeps = false;
      }
      if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;
      if (!inDeps) continue;
      const m = trimmed.match(PY_LINE_RE);
      if (!m) continue;
      const [, name, version] = m;
      if (!name || !version) continue;
      const key = `pip:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, version, ecosystem: 'pip' });
    }
  }

  // .github/workflows/*.yml — `uses: <action>@<sha-or-tag>`
  const GH_USES_RE = /^\s*uses:\s*([^\s#]+)/;
  for (const f of files) {
    if (!/^\.github\/workflows\/.+\.ya?ml$/.test(f.path)) continue;
    if (!f.patch) continue;
    for (const rawLine of f.patch.split('\n')) {
      if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue;
      const trimmed = rawLine.slice(1);
      const m = trimmed.match(GH_USES_RE);
      if (!m) continue;
      const ref = m[1];
      if (!ref) continue;
      const [name, version = 'unpinned'] = ref.split('@');
      const key = `gha:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, version, ecosystem: 'github-actions' });
    }
  }

  return out;
}

/**
 * Prompt-injection canary patterns. These are conservative — false
 * positives are fine because the bot only flags for human review;
 * it never auto-rejects.
 */
const PROMPT_INJECTION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'ignore-previous-instructions', re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i },
  { id: 'disregard', re: /disregard\s+(all\s+)?(previous|prior|above)/i },
  { id: 'system-prompt-leak', re: /(reveal|print|show|output)\s+(your\s+)?(system|hidden|secret)\s+prompt/i },
  { id: 'role-override', re: /you\s+are\s+now\s+(a|an|the)\s+/i },
  { id: 'jailbreak-prefix', re: /\b(do anything now|DAN mode|developer mode)\b/i },
  { id: 'tool-spoof', re: /<<<\s*system\s*>>>|\[SYSTEM\]:|<\|im_start\|>system/i },
  { id: 'data-exfil', re: /(send|post|upload|exfiltrate)\s+(the\s+)?(secrets|credentials|tokens|api[\s-]?keys?)/i },
  { id: 'long-base64', re: /[A-Za-z0-9+/]{200,}={0,2}/ },
];

const PROMPT_FILE_RE = /^(config\/prompts\/|apps\/[^/]+\/prompts\/|prompts\/|.+\.mdx?$)/;

export function scanPromptInjection(
  files: ReadonlyArray<{ path: string; patch?: string }>,
): string[] {
  const hits = new Set<string>();
  for (const f of files) {
    if (!PROMPT_FILE_RE.test(f.path)) continue;
    if (!f.patch) continue;
    for (const line of addedLines(f.patch)) {
      for (const p of PROMPT_INJECTION_PATTERNS) {
        if (p.re.test(line)) {
          hits.add(`${p.id} (${f.path})`);
        }
      }
    }
  }
  return [...hits].sort();
}

function shouldScanForCode(path: string): boolean {
  if (/\/(node_modules|\.next|dist|build|coverage)\//.test(path)) return false;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|sh|yml|yaml|toml|json)$/i.test(path)) {
    return true;
  }
  return false;
}

function stripComment(line: string): string {
  // Drop // and # comments — naive enough but reduces false positives.
  const slash = line.indexOf('//');
  const hash = line.indexOf('#');
  let cut = line.length;
  if (slash >= 0) cut = Math.min(cut, slash);
  if (hash >= 0) cut = Math.min(cut, hash);
  return line.slice(0, cut);
}
