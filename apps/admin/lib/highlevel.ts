/**
 * Read-only HighLevel (GoHighLevel) API client for the admin dashboard.
 *
 * Mirrors the contacts + tags + conversations surface of the GHL
 * sub-account that auth-sms and the web app write to (see
 * docs/61-highlevel-integration.md). We use this to compute drift
 * (how many users we have vs how many landed in the CRM) and to
 * surface tag breakdowns + recent contact activity in the admin UI.
 *
 * Auth: Private Integration Token (`pit-...`), already provisioned for
 * the write path. We never write through this module; every mutation
 * goes through the canonical service (auth-sms for user sync, web for
 * pool sync).
 */

const DEFAULT_BASE = "https://services.leadconnectorhq.com";

function base(): string {
  return (
    process.env.GHL_API_BASE_URL ||
    process.env.HIGHLEVEL_API_BASE_URL ||
    DEFAULT_BASE
  ).replace(/\/+$/, "");
}

function token(): string | null {
  return (
    process.env.GHL_API_KEY ||
    process.env.HIGHLEVEL_API_KEY ||
    null
  );
}

function locationId(): string | null {
  return (
    process.env.GHL_LOCATION_ID ||
    process.env.HIGHLEVEL_LOCATION_ID ||
    null
  );
}

/** True when the admin is wired to talk to a live GHL sub-account. */
export function isHighLevelConfigured(): boolean {
  return token() !== null && locationId() !== null;
}

const HEADERS_BASE = {
  Accept: "application/json",
  Version: "2021-07-28",
};

const FETCH_TIMEOUT_MS = 4500;

async function ghlGet<T>(path: string, query: Record<string, string | number> = {}): Promise<T | null> {
  const tok = token();
  const loc = locationId();
  if (!tok || !loc) return null;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) params.set(k, String(v));
  const url = `${base()}${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { ...HEADERS_BASE, Authorization: `Bearer ${tok}` },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ---------------- contacts ---------------------------------------------

interface ContactsListResponse {
  contacts: ReadonlyArray<{
    id: string;
    contactName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    country?: string | null;
    tags?: string[];
    source?: string | null;
    dateAdded?: string;
  }>;
  meta: {
    total?: number;
    nextPageUrl?: string | null;
    startAfter?: number | null;
    startAfterId?: string | null;
  };
}

export interface HighLevelContact {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly country: string | null;
  readonly tags: ReadonlyArray<string>;
  readonly source: string | null;
  readonly dateAdded: string | null;
}

export interface HighLevelSnapshot {
  readonly total: number;
  readonly recent: ReadonlyArray<HighLevelContact>;
  readonly fetchedAt: string;
}

function mapContact(c: ContactsListResponse["contacts"][number]): HighLevelContact {
  const name =
    (c.contactName ?? "").trim() ||
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.email ||
    c.phone ||
    c.id.slice(0, 8);
  return {
    id: c.id,
    name,
    email: c.email ?? null,
    phone: c.phone ?? null,
    country: c.country ?? null,
    tags: c.tags ?? [],
    source: c.source ?? null,
    dateAdded: c.dateAdded ?? null,
  };
}

export async function fetchContactsSnapshot(limit = 10): Promise<HighLevelSnapshot | null> {
  const loc = locationId();
  if (!loc) return null;
  const data = await ghlGet<ContactsListResponse>(
    "/contacts/",
    { locationId: loc, limit },
  );
  if (!data) return null;
  return {
    total: data.meta?.total ?? data.contacts.length,
    recent: data.contacts.map(mapContact),
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------- tags -------------------------------------------------

interface TagsResponse {
  tags: ReadonlyArray<{ id: string; name: string }>;
}

export async function fetchTags(): Promise<{ id: string; name: string }[] | null> {
  const loc = locationId();
  if (!loc) return null;
  const data = await ghlGet<TagsResponse>(`/locations/${loc}/tags`, {});
  if (!data) return null;
  return data.tags.map((t) => ({ id: t.id, name: t.name }));
}

interface ContactsSearchBody {
  meta?: { total?: number };
}

/**
 * Contact count for a specific tag. Uses `/contacts/?query=...` filtering
 * by tag, capped at `limit: 1` (we only need the meta.total). Returns
 * null when GHL isn't configured; falls back to 0 when the search
 * succeeds but no matches exist.
 */
export async function fetchContactCountForTag(tag: string): Promise<number | null> {
  const loc = locationId();
  if (!loc) return null;
  const data = await ghlGet<ContactsListResponse>(
    "/contacts/",
    { locationId: loc, query: tag, limit: 1 },
  );
  if (!data) return null;
  // GHL's `query` matches name/email/phone/tag substring. To narrow to
  // exact tag matches we'd need /contacts/search (POST). For the admin
  // overview the approximate count is good enough; tighten later if the
  // numbers look off.
  return data.meta?.total ?? data.contacts.length;
}

// ---------------- conversations ----------------------------------------

interface ConversationsSearchResponse {
  conversations: ReadonlyArray<{
    id: string;
    contactId: string;
    lastMessageBody?: string | null;
    lastMessageType?: string | null;
    lastMessageDate?: string | null;
    unreadCount?: number;
  }>;
  total?: number;
}

export interface HighLevelConversation {
  readonly id: string;
  readonly contactId: string;
  readonly lastMessageType: string | null;
  readonly lastMessageDate: string | null;
  readonly unreadCount: number;
}

export async function fetchRecentConversations(
  limit = 10,
): Promise<HighLevelConversation[] | null> {
  const loc = locationId();
  if (!loc) return null;
  const data = await ghlGet<ConversationsSearchResponse>(
    "/conversations/search",
    { locationId: loc, limit },
  );
  if (!data) return null;
  return data.conversations.map((c) => ({
    id: c.id,
    contactId: c.contactId,
    lastMessageType: c.lastMessageType ?? null,
    lastMessageDate: c.lastMessageDate ?? null,
    unreadCount: c.unreadCount ?? 0,
  }));
}
