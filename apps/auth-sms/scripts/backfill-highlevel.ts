/**
 * One-off backfill: push every already-registered user into HighLevel as
 * a `player` contact. Use this to seed the CRM with users who signed up
 * before the live registration sync (apps/auth-sms/src/highlevel.ts)
 * existed.
 *
 * It is idempotent in two ways: the GHL endpoint is `/contacts/upsert`
 * (merge by email/phone), and rows that already carry a
 * `highlevel_contact_id` are skipped unless `--force` is passed.
 *
 * SAFE BY DEFAULT: with no flags it runs a DRY RUN — it prints exactly
 * which contacts would be created/updated and makes no network calls and
 * no DB writes. Add `--live` to actually write to HighLevel.
 *
 * Usage:
 *   # Dry run against the live auth DB (no writes):
 *   pnpm --filter @vtorn/auth-sms exec tsx scripts/backfill-highlevel.ts \
 *     --env-file=.env --db=./data/auth.db
 *
 *   # For real:
 *   pnpm --filter @vtorn/auth-sms exec tsx scripts/backfill-highlevel.ts \
 *     --env-file=.env --db=./data/auth.db --live
 *
 * Flags:
 *   --env-file=PATH  Load env (GHL_API_KEY etc.) from this file first.
 *   --db=PATH        SQLite path (default $AUTH_DB_PATH or ./data/auth.db).
 *   --live           Actually call HighLevel + write back contact ids.
 *   --force          Re-sync users that already have a highlevel_contact_id.
 */

import { existsSync } from 'node:fs';

import { Storage, type UserRecord } from '../src/storage.js';
import {
  isHighLevelConfigured,
  syncUserToHighLevel,
  PLAYER_TAG,
} from '../src/highlevel.js';

interface Args {
  envFile?: string;
  db: string;
  live: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    db: process.env.AUTH_DB_PATH ?? './data/auth.db',
    live: false,
    force: false,
  };
  for (const a of argv) {
    if (a === '--live') args.live = true;
    else if (a === '--force') args.force = true;
    else if (a.startsWith('--env-file=')) args.envFile = a.slice('--env-file='.length);
    else if (a.startsWith('--db=')) args.db = a.slice('--db='.length);
  }
  return args;
}

/** Mask PII so the backfill log can be pasted into a ticket safely. */
function mask(value: string | null, keep = 2): string {
  if (!value) return '(none)';
  if (value.length <= keep) return '*'.repeat(value.length);
  return value.slice(0, keep) + '*'.repeat(Math.max(1, value.length - keep));
}

function describe(user: UserRecord): string {
  const name =
    user.display_name || [user.first_name, user.last_name].filter(Boolean).join(' ');
  return [
    `id=${user.id}`,
    `name=${name || '(blank)'}`,
    `phone=${mask(user.phone)}`,
    `email=${mask(user.email, 3)}`,
    `synced=${user.highlevel_contact_id ? 'yes' : 'no'}`,
  ].join('  ');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.envFile) {
    if (!existsSync(args.envFile)) {
      console.error(`env-file not found: ${args.envFile}`);
      process.exit(1);
    }
    process.loadEnvFile(args.envFile);
  }

  if (!existsSync(args.db)) {
    console.error(`auth DB not found: ${args.db}`);
    process.exit(1);
  }

  const mode = args.live ? 'LIVE' : 'DRY RUN';
  console.log(`\nHighLevel backfill — ${mode}`);
  console.log(`  db:        ${args.db}`);
  console.log(`  location:  ${process.env.GHL_LOCATION_ID ?? '(unset)'}`);
  console.log(`  configured: ${isHighLevelConfigured()}`);
  console.log(`  tag:       ${PLAYER_TAG}`);
  console.log(`  force:     ${args.force}\n`);

  if (args.live && !isHighLevelConfigured()) {
    console.error('Refusing to run --live without GHL_API_KEY + GHL_LOCATION_ID set.');
    process.exit(1);
  }

  const storage = new Storage({ path: args.db });

  // Contactable users only: GHL needs a phone or email.
  const rows = storage.db
    .prepare(
      `SELECT * FROM user
        WHERE phone IS NOT NULL OR email IS NOT NULL
        ORDER BY created_at ASC`,
    )
    .all() as UserRecord[];

  const now = Math.floor(Date.now() / 1000);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of rows) {
    const alreadySynced = Boolean(user.highlevel_contact_id);
    if (alreadySynced && !args.force) {
      console.log(`SKIP   ${describe(user)}  (already synced)`);
      skipped++;
      continue;
    }

    if (!args.live) {
      console.log(`WOULD  ${describe(user)}`);
      created++;
      continue;
    }

    const result = await syncUserToHighLevel(storage, user, {
      now,
      log: { info: () => {}, warn: () => {} },
    });
    if (result.status === 'synced') {
      console.log(`OK     ${describe(user)}  -> ${result.contactId}`);
      created++;
    } else if (result.status === 'skipped') {
      console.log(`SKIP   ${describe(user)}  (skipped: ${result.error ?? 'no contact key'})`);
      skipped++;
    } else {
      console.error(`FAIL   ${describe(user)}  (${result.error})`);
      failed++;
    }
  }

  console.log(
    `\n${mode} complete — ${rows.length} contactable users: ` +
      `${args.live ? created + ' synced' : created + ' would sync'}, ` +
      `${skipped} skipped, ${failed} failed.\n`,
  );
  if (!args.live) {
    console.log('No data was written. Re-run with --live to push to HighLevel.\n');
  }

  storage.db.close();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
