#!/usr/bin/env node
// tasks-to-issues.mjs — sync `tasks/inbox/*.md` to GitHub Issues.
//
// The repo has a local kanban at `tasks/inbox/` with frontmatter
// (`id`, `title`, `owner`, `status`, `priority`, `labels`, `links`).
// CONTRIBUTING.md describes it; agents and humans both consume it.
//
// This script reconciles `tasks/inbox/` with GitHub Issues so that an
// external bot (e.g. a Cursor agent pointed at the repo) can discover
// pickable work through the standard issues-API, not by reading the
// markdown kanban.
//
// Usage:
//   node tools/tasks-to-issues.mjs                  # dry-run
//   node tools/tasks-to-issues.mjs --apply          # actually creates / updates issues
//   node tools/tasks-to-issues.mjs --inbox <path>   # override the inbox path
//
// Auth: reads GITHUB_TOKEN from env (use a fine-grained token with
// `repo:issues:write` for the tournamental repo).
//
// Apache 2.0.

import { readdir, readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";

const REPO = process.env.GITHUB_REPOSITORY ?? "0800tim/tournamental";
const TOKEN = process.env.GITHUB_TOKEN;
const APPLY = process.argv.includes("--apply");
const inboxIdx = process.argv.indexOf("--inbox");
const INBOX = inboxIdx >= 0 ? process.argv[inboxIdx + 1] : "tasks/inbox";

if (!TOKEN && APPLY) {
  console.error("--apply requires GITHUB_TOKEN in env");
  process.exit(1);
}

const log = (...m) => console.log("[tasks-to-issues]", ...m);

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const [, header, body] = m;
  const meta = {};
  for (const line of header.split("\n")) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    meta[k] = v.replace(/^["']|["']$/g, "");
  }
  return { meta, body };
}

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      "user-agent": "tournamental-tasks-to-issues",
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${path} -> HTTP ${r.status} ${text}`);
  }
  return r.json();
}

async function listExistingAgentTasks() {
  if (!TOKEN) return new Map();
  // GH Search API: agent-task label, open, in this repo.
  const r = await gh(
    `/search/issues?q=${encodeURIComponent(
      `repo:${REPO} is:issue is:open label:agent-task`,
    )}&per_page=100`,
  );
  const map = new Map();
  for (const it of r.items ?? []) {
    // We use a hidden marker in the body to correlate: `<!-- task-id:NNNN -->`
    const m = it.body?.match(/<!--\s*task-id:([0-9a-zA-Z-]+)\s*-->/);
    if (m) map.set(m[1], it);
  }
  return map;
}

async function main() {
  const inboxAbs = resolve(INBOX);
  const files = (await readdir(inboxAbs))
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => resolve(inboxAbs, f));

  log(`scanning ${files.length} tasks under ${INBOX}/`);

  const existing = await listExistingAgentTasks();
  log(`found ${existing.size} existing open agent-task issues to reconcile against`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const path of files) {
    const raw = await readFile(path, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const id = meta.id ?? basename(path, ".md");
    const title = meta.title ?? `[agent-task] ${id}`;

    const labels = ["agent-task"];
    if (meta.labels) {
      for (const l of meta.labels.split(",")) labels.push(l.trim());
    }

    const issueBody =
      `${body.trim()}\n\n---\n` +
      `_Source: \`${INBOX}/${basename(path)}\`_\n` +
      `<!-- task-id:${id} -->`;

    const existingIssue = existing.get(id);
    if (existingIssue) {
      const needsUpdate =
        existingIssue.title !== title ||
        (existingIssue.body ?? "").trim() !== issueBody.trim();
      if (!needsUpdate) {
        skipped++;
        continue;
      }
      log(`would update issue #${existingIssue.number} (${id})`);
      if (APPLY) {
        await gh(`/repos/${REPO}/issues/${existingIssue.number}`, {
          method: "PATCH",
          body: JSON.stringify({ title, body: issueBody, labels }),
        });
      }
      updated++;
    } else {
      log(`would create issue for ${id}: ${title}`);
      if (APPLY) {
        await gh(`/repos/${REPO}/issues`, {
          method: "POST",
          body: JSON.stringify({ title, body: issueBody, labels }),
        });
      }
      created++;
    }
  }

  log(`done: ${created} created, ${updated} updated, ${skipped} unchanged`);
  if (!APPLY) {
    log("(dry-run; pass --apply to commit)");
  }
}

main().catch((e) => {
  console.error("[tasks-to-issues]", e.message);
  process.exit(1);
});
