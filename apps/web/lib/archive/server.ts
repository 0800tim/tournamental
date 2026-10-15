/**
 * Server-side archive detection. Mirrors lib/archive/context.tsx for
 * React Server Components and route handlers: middleware stamps
 * `x-tnm-archive: <slug>` on requests to archived-tournament hosts.
 */

import { headers } from "next/headers";

export const ARCHIVE_HEADER = "x-tnm-archive";
export const HUB_HEADER = "x-tnm-hub";

export async function isHubRequest(): Promise<boolean> {
  try {
    const h = await headers();
    return h.get(HUB_HEADER) === "1";
  } catch {
    return false;
  }
}

export async function archiveSlug(): Promise<string | null> {
  try {
    const h = await headers();
    const v = h.get(ARCHIVE_HEADER);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function isArchiveRequest(): Promise<boolean> {
  return (await archiveSlug()) !== null;
}

/**
 * Archive-safe count phrasing. Raw counts of people are never shown in
 * the archive; callers pass the live count and get back either the
 * normal phrase (live) or a count-free phrase (archive).
 */
export function membersPhrase(count: number, archive: boolean): string {
  if (archive) return "Members";
  return `${count} ${count === 1 ? "member" : "members"}`;
}
