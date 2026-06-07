/**
 * Optional Supabase persistence for the browser swarm.
 *
 * When the operator pastes a Supabase URL + anon key, the swarm starts
 * writing bot/pick/commit rows to Supabase as well as IndexedDB. This
 * gives the user a persistent multi-device record of their swarm and,
 * crucially, gives them a public-shareable read URL for their best
 * bots once the World Cup is underway.
 *
 * We intentionally only require the `anon` key. The schema lives in the
 * user's own Supabase project under their own RLS policies; we never
 * touch service-role keys in the browser. The setup tutorial in
 * `apps/web/app/run/tutorial.md` walks the user through pasting the
 * SQL block below into their Supabase SQL editor, which provisions
 * everything in one shot.
 *
 * Dependency note: `@supabase/supabase-js` is already in `apps/web`'s
 * package.json (used by the magic-link auth flow). We import it
 * dynamically so the run-page bundle stays slim for users who don't
 * configure Supabase.
 */

import type {
  BotPick,
  BotRecord,
  CommitLogRow,
  NodeCredentials,
  SupabaseConfig,
} from "./types";

export const SUPABASE_SCHEMA_SQL = /* sql */ `
-- Tournamental Browser-Swarm schema.
-- Paste into the Supabase SQL editor for your own project. Safe to
-- re-run. Creates four tables and a public-read RLS policy so anyone
-- with your project's anon key can read your leaderboard but only you
-- (via service role) can mutate it.

create table if not exists bot (
  bot_id        text primary key,
  seed          text not null,
  strategy      text not null,
  chalk_score   numeric not null,
  created_at    bigint not null
);

create table if not exists bot_pick (
  bot_id           text not null,
  match_id         text not null,
  outcome          text not null check (outcome in ('home_win','draw','away_win')),
  chalk_score      numeric not null,
  locked_at_utc    bigint not null,
  committed_at_utc bigint,
  primary key (bot_id, match_id)
);

create index if not exists bot_pick_by_match on bot_pick (match_id);

create table if not exists commit_log (
  match_id           text primary key,
  merkle_root        text not null,
  bot_count          integer not null,
  kickoff_at_utc     bigint not null,
  committed_at_utc   bigint not null,
  central_ack_at_utc bigint
);

create table if not exists node_creds (
  node_id            text primary key,
  node_secret        text not null,
  operator_email     text,
  central_base_url   text not null,
  registered_at_utc  bigint not null
);

alter table bot enable row level security;
alter table bot_pick enable row level security;
alter table commit_log enable row level security;
alter table node_creds enable row level security;

-- Public-read so anyone can verify your leaderboard with just the anon
-- key. If you'd rather keep it private, replace 'true' with 'false'.
do $$ begin
  if not exists (
    select 1 from pg_policies where policyname = 'public_read_bot'
  ) then
    create policy public_read_bot on bot for select using (true);
  end if;
  if not exists (
    select 1 from pg_policies where policyname = 'public_read_bot_pick'
  ) then
    create policy public_read_bot_pick on bot_pick for select using (true);
  end if;
  if not exists (
    select 1 from pg_policies where policyname = 'public_read_commit_log'
  ) then
    create policy public_read_commit_log on commit_log for select using (true);
  end if;
end $$;
`;

interface MinimalSupabaseClient {
  from(table: string): {
    upsert(rows: unknown, opts?: { onConflict?: string }): Promise<{ error: { message: string } | null }>;
    select(cols: string): Promise<{ data: unknown; error: { message: string } | null }>;
  };
}

let cachedClient: { url: string; client: MinimalSupabaseClient } | null = null;

async function getClient(cfg: SupabaseConfig): Promise<MinimalSupabaseClient | null> {
  if (cachedClient && cachedClient.url === cfg.url) return cachedClient.client;
  try {
    const mod = await import("@supabase/supabase-js");
    const client = mod.createClient(cfg.url, cfg.anon_key, {
      auth: { persistSession: false },
    }) as unknown as MinimalSupabaseClient;
    cachedClient = { url: cfg.url, client };
    return client;
  } catch {
    return null;
  }
}

export interface SupabasePersistenceResult {
  ok: boolean;
  error: string | null;
}

async function tryUpsert(
  cfg: SupabaseConfig,
  table: string,
  rows: readonly unknown[],
  onConflict: string,
): Promise<SupabasePersistenceResult> {
  if (rows.length === 0) return { ok: true, error: null };
  const client = await getClient(cfg);
  if (!client) {
    return { ok: false, error: "supabase-js not available" };
  }
  try {
    const res = await client.from(table).upsert(rows, { onConflict });
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const supabasePersistence = {
  async saveBots(
    cfg: SupabaseConfig,
    bots: readonly BotRecord[],
  ): Promise<SupabasePersistenceResult> {
    return tryUpsert(cfg, "bot", bots, "bot_id");
  },
  async savePicks(
    cfg: SupabaseConfig,
    picks: readonly BotPick[],
  ): Promise<SupabasePersistenceResult> {
    return tryUpsert(cfg, "bot_pick", picks, "bot_id,match_id");
  },
  async saveCommit(
    cfg: SupabaseConfig,
    row: CommitLogRow,
  ): Promise<SupabasePersistenceResult> {
    return tryUpsert(cfg, "commit_log", [row], "match_id");
  },
  async saveCredentials(
    cfg: SupabaseConfig,
    creds: NodeCredentials,
  ): Promise<SupabasePersistenceResult> {
    return tryUpsert(cfg, "node_creds", [creds], "node_id");
  },
};

/**
 * Light probe so the UI can show a green tick before the user kicks off
 * a swarm run. Returns true if the URL + anon key combination accepted
 * a no-op read against the bot table.
 */
export async function probeSupabase(cfg: SupabaseConfig): Promise<boolean> {
  const client = await getClient(cfg);
  if (!client) return false;
  try {
    const res = await client.from("bot").select("bot_id");
    return res.error === null;
  } catch {
    return false;
  }
}
