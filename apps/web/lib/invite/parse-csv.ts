/**
 * CSV parser + warm-invite URL builder for the bulk-invite feature.
 *
 * Pure functions, no I/O. Tested in `__tests__/invite-parse-csv.test.ts`.
 *
 * Input: an uploaded CSV file's text contents. Output: a list of
 * `InviteContact` rows, ready to be queued by the API route.
 *
 * We accept loose header conventions (first_name / firstname / fname,
 * email, phone / mobile / msisdn) so an operator copying contacts out
 * of HighLevel, Mailchimp, or Apple Contacts doesn't have to rename
 * columns. Lines with neither phone nor email are skipped.
 */

export interface InviteContact {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
  readonly phoneE164: string | null;
  /** Original 1-indexed CSV row number (excluding header), for error
   *  reporting. */
  readonly sourceRow: number;
}

export interface ParseResult {
  readonly contacts: InviteContact[];
  readonly skipped: ReadonlyArray<{
    readonly row: number;
    readonly reason: "no_contact" | "bad_email" | "bad_phone";
    readonly raw: string;
  }>;
  readonly header: ReadonlyArray<string>;
  readonly totalDataRows: number;
}

const HEADER_ALIASES: Record<string, ReadonlyArray<string>> = {
  firstName: ["first_name", "firstname", "first", "fname", "given_name", "given"],
  lastName: ["last_name", "lastname", "surname", "last", "lname", "family_name", "family"],
  email: ["email", "email_address", "e-mail", "mail"],
  phone: [
    "phone",
    "phone_number",
    "mobile",
    "mobile_number",
    "msisdn",
    "cell",
    "cellphone",
    "whatsapp",
    "wa",
    "wa_number",
  ],
};

function normaliseHeaderKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]/g, "");
}

function detectColumn(headers: string[], aliases: ReadonlyArray<string>): number {
  for (let i = 0; i < headers.length; i += 1) {
    if (aliases.includes(headers[i])) return i;
  }
  return -1;
}

/**
 * Tiny CSV row parser. Handles `"quoted, commas"` and `""` escapes; no
 * support for embedded newlines inside quoted fields (rare in contact
 * lists; a future iteration can pull in `csv-parse` if needed).
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Normalise a phone number to E.164. Accepts:
 *  - Already-E.164 inputs (`+6421...`)
 *  - NZ local form (`0212345678` → `+64212345678`)
 *  - AU local form (`04xx xxx xxx` → `+614xxxxxxxx`)
 *  - Bare digits with country code (`6421...` → `+6421...`)
 *
 * Returns null when the input doesn't look like a phone at all. The
 * `defaultCountryCode` argument lets the caller decide the fallback
 * country (e.g. read from the pool's country, default "NZ").
 */
export function normalisePhone(
  raw: string | null | undefined,
  defaultCountryCode: "NZ" | "AU" | "GB" | "US" = "NZ",
): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.length === 0) return null;
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    return `+${digits}`;
  }
  // Strip leading 00 international prefix.
  if (s.startsWith("00")) {
    s = s.slice(2);
    return /^\d{8,15}$/.test(s) ? `+${s}` : null;
  }
  // Country-specific local-form heuristics.
  const COUNTRY_CC: Record<typeof defaultCountryCode, string> = {
    NZ: "64",
    AU: "61",
    GB: "44",
    US: "1",
  };
  const cc = COUNTRY_CC[defaultCountryCode];
  if (s.startsWith("0")) {
    s = s.slice(1);
    return /^\d{7,14}$/.test(s) ? `+${cc}${s}` : null;
  }
  // Bare digits — might already include country code.
  if (/^\d{8,15}$/.test(s)) {
    return `+${s}`;
  }
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validEmail(s: string | null): boolean {
  if (!s) return false;
  return EMAIL_RE.test(s.trim());
}

export interface ParseOptions {
  readonly defaultCountryCode?: "NZ" | "AU" | "GB" | "US";
  /** Cap recipients so a 100k-row CSV doesn't lock up the UI. The API
   *  enforces the real cap; this is a defensive client-side guard. */
  readonly maxRows?: number;
}

export function parseInviteCsv(
  text: string,
  opts: ParseOptions = {},
): ParseResult {
  const maxRows = opts.maxRows ?? 50_000;
  const defaultCC = opts.defaultCountryCode ?? "NZ";

  // Strip BOM + normalise line endings.
  const cleaned = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = cleaned.split("\n").filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { contacts: [], skipped: [], header: [], totalDataRows: 0 };
  }

  const rawHeaders = parseCsvLine(lines[0]).map(normaliseHeaderKey);
  const firstNameIdx = detectColumn(rawHeaders, HEADER_ALIASES.firstName);
  const lastNameIdx = detectColumn(rawHeaders, HEADER_ALIASES.lastName);
  const emailIdx = detectColumn(rawHeaders, HEADER_ALIASES.email);
  const phoneIdx = detectColumn(rawHeaders, HEADER_ALIASES.phone);

  // If there's no header row (no email/phone/firstname column detected),
  // assume the file is headerless with order `first_name, email, phone`.
  const hasHeader = emailIdx !== -1 || phoneIdx !== -1 || firstNameIdx !== -1;
  const dataStart = hasHeader ? 1 : 0;
  const fallback = {
    firstName: 0,
    lastName: -1,
    email: 1,
    phone: 2,
  };

  const contacts: InviteContact[] = [];
  const skipped: {
    row: number;
    reason: "no_contact" | "bad_email" | "bad_phone";
    raw: string;
  }[] = [];

  for (let i = dataStart; i < lines.length && contacts.length < maxRows; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const sourceRow = i - dataStart + 1;
    const get = (idx: number) => (idx >= 0 && idx < cells.length ? cells[idx].trim() : "");
    const firstName = hasHeader
      ? get(firstNameIdx)
      : get(fallback.firstName);
    const lastName = hasHeader ? get(lastNameIdx) : get(fallback.lastName);
    const rawEmail = hasHeader ? get(emailIdx) : get(fallback.email);
    const rawPhone = hasHeader ? get(phoneIdx) : get(fallback.phone);

    const email = rawEmail.length > 0 ? rawEmail.toLowerCase() : null;
    const phoneE164 = normalisePhone(rawPhone, defaultCC);

    if (rawEmail && !validEmail(email)) {
      skipped.push({ row: sourceRow, reason: "bad_email", raw: lines[i] });
      continue;
    }
    if (rawPhone && !phoneE164) {
      skipped.push({ row: sourceRow, reason: "bad_phone", raw: lines[i] });
      continue;
    }
    if (!email && !phoneE164) {
      skipped.push({ row: sourceRow, reason: "no_contact", raw: lines[i] });
      continue;
    }

    contacts.push({
      firstName: firstName || null,
      lastName: lastName || null,
      email,
      phoneE164,
      sourceRow,
    });
  }

  return {
    contacts,
    skipped,
    header: rawHeaders,
    totalDataRows: lines.length - dataStart,
  };
}

/**
 * Build the warm-invite URL for one recipient. Matches the param names
 * the join flow already understands (see
 * apps/web/components/join/JoinFlowClient.tsx::parseWarmInvite).
 *
 * `origin` defaults to https://play.tournamental.com — caller can pass
 * a dev origin for local testing.
 */
export function buildWarmInviteUrl(args: {
  readonly slug: string;
  readonly contact: Pick<InviteContact, "firstName" | "email" | "phoneE164">;
  readonly origin?: string;
  readonly ref?: string;
}): string {
  const origin = (args.origin ?? "https://play.tournamental.com").replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (args.contact.firstName) params.set("firstname", args.contact.firstName);
  if (args.contact.phoneE164) params.set("mobile", args.contact.phoneE164);
  if (args.contact.email) params.set("email", args.contact.email);
  if (args.ref) params.set("ref", args.ref);
  const qs = params.toString();
  return `${origin}/s/${encodeURIComponent(args.slug)}/join${qs ? "?" + qs : ""}`;
}

/**
 * Substitute message variables (`{{first_name}}`, `{{pool_name}}`,
 * `{{join_url}}`, `{{owner_name}}`). Pure; safe to call with arbitrary
 * user input on the server. Returns the rendered string, truncated to
 * the caller's hard cap.
 */
export function renderInviteMessage(args: {
  readonly template: string;
  readonly firstName: string | null;
  readonly poolName: string;
  readonly ownerName: string;
  readonly joinUrl: string;
  readonly maxChars?: number;
}): string {
  const max = args.maxChars ?? 1000;
  const map: Record<string, string> = {
    first_name: args.firstName ?? "there",
    pool_name: args.poolName,
    owner_name: args.ownerName,
    join_url: args.joinUrl,
  };
  let out = args.template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (full, key) =>
    Object.prototype.hasOwnProperty.call(map, key) ? map[key] : full,
  );
  // Always append the join URL on its own line if the template didn't
  // include `{{join_url}}` — invisible safety net so we never send a
  // message without the link.
  if (!args.template.includes("{{join_url}}") && !out.includes(args.joinUrl)) {
    out = `${out}\n\n${args.joinUrl}`;
  }
  if (out.length > max) out = out.slice(0, max - 1) + "…";
  return out;
}
