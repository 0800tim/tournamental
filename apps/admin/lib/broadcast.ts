/**
 * Broadcast feature library.
 *
 * Pure functions that the /broadcast page and /api/admin/broadcast route
 * share. Kept side-effect-free so the unit tests can exercise template
 * loading, variable substitution, channel filtering, and dry-run shape
 * without spinning up a Next.js request.
 *
 * Templates live as markdown files under `apps/admin/data/playbooks/`
 * with YAML-front-matter `name` / `description` / `recommended` /
 * `default_channels`. Variables `{{pool_name}}` / `{{owner_handle}}` /
 * `{{tournament}}` / `{{member_count}}` are substituted server-side per
 * recipient.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export type BroadcastChannel = "whatsapp" | "email";

export interface PlaybookTemplate {
  /** Slug derived from the filename, e.g. "welcome". */
  readonly id: string;
  /** Front-matter `name`. */
  readonly name: string;
  /** Front-matter `description`. */
  readonly description: string;
  /** Front-matter `recommended` (defaults to false). */
  readonly recommended: boolean;
  /** Front-matter `default_channels` (defaults to ["whatsapp"]). */
  readonly defaultChannels: ReadonlyArray<BroadcastChannel>;
  /** Markdown body with `{{var}}` placeholders, unrendered. */
  readonly body: string;
}

export interface BroadcastRecipient {
  readonly slug: string;
  readonly poolName: string;
  readonly ownerHandle: string;
  readonly ownerEmail: string | null;
  readonly ownerPhone: string | null;
  readonly tournament: string;
  readonly memberCount: number;
}

export interface RenderedBroadcast {
  readonly slug: string;
  readonly poolName: string;
  readonly ownerHandle: string;
  readonly channels: ReadonlyArray<BroadcastChannel>;
  /** Channels we want to send but can't because the recipient is
   *  missing the address (e.g. no owner_phone). */
  readonly skippedChannels: ReadonlyArray<{
    channel: BroadcastChannel;
    reason: "missing_phone" | "missing_email";
  }>;
  readonly subject: string;
  readonly body: string;
}

export interface BroadcastDryRun {
  readonly dryRun: true;
  readonly count: number;
  readonly messages: ReadonlyArray<RenderedBroadcast>;
}

export interface BroadcastLiveResult {
  readonly dryRun: false;
  readonly count: number;
  readonly results: ReadonlyArray<{
    readonly slug: string;
    readonly channel: BroadcastChannel;
    readonly status: "sent" | "skipped" | "failed" | "not_implemented_yet";
    readonly reason?: string;
  }>;
}

export type BroadcastResult = BroadcastDryRun | BroadcastLiveResult;

const PLAYBOOKS_DIR = path.join(process.cwd(), "data", "playbooks");

/**
 * Tiny YAML front-matter parser. We support only the keys we use:
 * `name`, `description`, `recommended` (boolean), and `default_channels`
 * (block list of strings). Pulling in `gray-matter` for this would
 * inflate the admin bundle for one feature; the parser below is ~30
 * lines and round-trips our own template format faithfully.
 */
export function parseFrontMatter(
  raw: string,
): { meta: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) {
    return { meta: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const header = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");

  const meta: Record<string, unknown> = {};
  let pendingListKey: string | null = null;
  const list: string[] = [];
  const flushList = () => {
    if (pendingListKey !== null) {
      meta[pendingListKey] = [...list];
      list.length = 0;
      pendingListKey = null;
    }
  };

  for (const lineRaw of header.split(/\r?\n/)) {
    const line = lineRaw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && pendingListKey !== null) {
      list.push(listMatch[1].trim());
      continue;
    }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    flushList();
    const key = kv[1];
    const valRaw = kv[2].trim();
    if (valRaw === "") {
      pendingListKey = key;
      continue;
    }
    if (valRaw === "true" || valRaw === "false") {
      meta[key] = valRaw === "true";
    } else {
      meta[key] = valRaw.replace(/^["']|["']$/g, "");
    }
  }
  flushList();
  return { meta, body };
}

function coerceChannels(v: unknown): BroadcastChannel[] {
  if (!Array.isArray(v)) return ["whatsapp"];
  const out: BroadcastChannel[] = [];
  for (const x of v) {
    if (x === "whatsapp" || x === "email") out.push(x);
  }
  return out.length ? out : ["whatsapp"];
}

/**
 * Load every `*.md` playbook from `data/playbooks/`. Filenames become
 * the template id (e.g. `welcome.md` -> `welcome`). Sorted with
 * `recommended` first, then alphabetic by name for stable UI ordering.
 */
export async function loadPlaybooks(
  dir: string = PLAYBOOKS_DIR,
): Promise<PlaybookTemplate[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith(".md"));
  const out: PlaybookTemplate[] = [];
  for (const f of files) {
    const raw = await fs.readFile(path.join(dir, f), "utf-8");
    const { meta, body } = parseFrontMatter(raw);
    const id = f.replace(/\.md$/, "");
    out.push({
      id,
      name: typeof meta.name === "string" ? meta.name : id,
      description:
        typeof meta.description === "string" ? meta.description : "",
      recommended: meta.recommended === true,
      defaultChannels: coerceChannels(meta.default_channels),
      body,
    });
  }
  out.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * Substitute the four supported `{{var}}` placeholders. Unknown
 * placeholders are left untouched so a typo is visible in the preview
 * rather than silently swallowed.
 */
export function substituteVariables(
  body: string,
  vars: {
    poolName: string;
    ownerHandle: string;
    tournament: string;
    memberCount: number;
  },
): string {
  const map: Record<string, string> = {
    pool_name: vars.poolName,
    owner_handle: vars.ownerHandle,
    tournament: vars.tournament,
    member_count: String(vars.memberCount),
  };
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (full, key: string) => {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : full;
  });
}

/** First non-empty markdown line, with leading `#` stripped, used as
 *  the email subject when sending the email channel. */
export function deriveSubject(body: string, poolName: string): string {
  const firstLine = body
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!firstLine) return `Tournamental update for ${poolName}`;
  const cleaned = firstLine.replace(/^#+\s*/, "").trim();
  if (cleaned.length > 80) return `Tournamental: ${poolName}`;
  return cleaned;
}

/**
 * Filter the user-requested channels down to those we can actually
 * deliver for this recipient. Returns the kept channels and the
 * skipped (channel + reason) entries for visibility in the preview.
 */
export function filterChannels(
  requested: ReadonlyArray<BroadcastChannel>,
  recipient: Pick<BroadcastRecipient, "ownerEmail" | "ownerPhone">,
): {
  kept: BroadcastChannel[];
  skipped: { channel: BroadcastChannel; reason: "missing_phone" | "missing_email" }[];
} {
  const kept: BroadcastChannel[] = [];
  const skipped: {
    channel: BroadcastChannel;
    reason: "missing_phone" | "missing_email";
  }[] = [];
  for (const c of requested) {
    if (c === "whatsapp") {
      if (recipient.ownerPhone && recipient.ownerPhone.length > 4) {
        kept.push("whatsapp");
      } else {
        skipped.push({ channel: "whatsapp", reason: "missing_phone" });
      }
    } else if (c === "email") {
      if (recipient.ownerEmail && /@/.test(recipient.ownerEmail)) {
        kept.push("email");
      } else {
        skipped.push({ channel: "email", reason: "missing_email" });
      }
    }
  }
  return { kept, skipped };
}

/** Render the body for a single recipient. Pure; no I/O. */
export function renderForRecipient(args: {
  body: string;
  recipient: BroadcastRecipient;
  channels: ReadonlyArray<BroadcastChannel>;
}): RenderedBroadcast {
  const rendered = substituteVariables(args.body, {
    poolName: args.recipient.poolName,
    ownerHandle: args.recipient.ownerHandle,
    tournament: args.recipient.tournament,
    memberCount: args.recipient.memberCount,
  });
  const { kept, skipped } = filterChannels(args.channels, args.recipient);
  return {
    slug: args.recipient.slug,
    poolName: args.recipient.poolName,
    ownerHandle: args.recipient.ownerHandle,
    channels: kept,
    skippedChannels: skipped,
    subject: deriveSubject(rendered, args.recipient.poolName),
    body: rendered,
  };
}
