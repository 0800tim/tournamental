/**
 * Commentary template loader + tiny Mustache-like substitution.
 *
 * Templates are stored as `templates/commentary.json` keyed by event family.
 * Each key maps to an array of strings; the simulation picks one
 * deterministically via the shared Rng.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Rng } from "./rng.js";

export type CommentaryBank = Record<string, string[]>;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_PATH = resolve(__dirname, "..", "templates", "commentary.json");

let cachedBank: CommentaryBank | null = null;

export function loadCommentaryBank(): CommentaryBank {
  if (cachedBank) return cachedBank;
  const raw = readFileSync(TEMPLATES_PATH, "utf8");
  cachedBank = JSON.parse(raw) as CommentaryBank;
  return cachedBank;
}

export function pickCommentary(
  bank: CommentaryBank,
  key: string,
  rng: Rng,
  vars: Record<string, string | number>,
): string {
  const templates = bank[key] ?? [`(${key})`];
  const template = templates[rng.intRange(0, templates.length - 1)] ?? `(${key})`;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}
