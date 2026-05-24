/**
 * Idempotent HighLevel location setup: ensure the custom fields the
 * Tournamental integration writes to actually exist on the sub-account.
 *
 * GHL silently drops custom-field values whose key doesn't resolve to a
 * defined field, so the contact sync (apps/auth-sms/src/highlevel.ts) and
 * the syndicate push (apps/web/lib/syndicate/ghl.ts) are only useful once
 * these fields exist. Run this once per location (safe to re-run — it
 * GETs first and only creates what's missing).
 *
 * Usage:
 *   pnpm --filter @vtorn/auth-sms exec tsx scripts/highlevel-setup.ts \
 *     --env-file=.env
 *
 * Flags:
 *   --env-file=PATH  Load GHL_API_KEY / GHL_LOCATION_ID from this file.
 *   --dry-run        List what exists / would be created; create nothing.
 *
 * Field-key contract (must match the `key`s sent by the clients):
 *   contact.vtourn_user_id   — internal user id, links contact ↔ user.
 *   contact.vtourn_admin_url — deep link to the admin dashboard user page.
 *   contact.vtourn_pool_ids  — comma-separated pool/syndicate ids owned.
 *   contact.syndicate_slug / _role / _tournament — syndicate-owner fields.
 */

import { existsSync } from 'node:fs';

const API_VERSION = '2021-07-28';
const DEFAULT_BASE_URL = 'https://services.leadconnectorhq.com';

/** name -> derived fieldKey GHL produces (lowercased, spaces→underscores). */
const DESIRED_FIELDS: Array<{ name: string; key: string; dataType: string }> = [
  { name: 'Vtourn User Id', key: 'contact.vtourn_user_id', dataType: 'TEXT' },
  { name: 'Vtourn Admin Url', key: 'contact.vtourn_admin_url', dataType: 'TEXT' },
  { name: 'Vtourn Pool Ids', key: 'contact.vtourn_pool_ids', dataType: 'TEXT' },
  { name: 'Syndicate Slug', key: 'contact.syndicate_slug', dataType: 'TEXT' },
  { name: 'Syndicate Role', key: 'contact.syndicate_role', dataType: 'TEXT' },
  { name: 'Syndicate Tournament', key: 'contact.syndicate_tournament', dataType: 'TEXT' },
];

interface GhlField {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
}

function baseUrl(): string {
  return (process.env.GHL_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: API_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function listFields(apiKey: string, locationId: string): Promise<GhlField[]> {
  const res = await fetch(`${baseUrl()}/locations/${locationId}/customFields`, {
    headers: headers(apiKey),
  });
  if (!res.ok) {
    throw new Error(`list customFields failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { customFields?: GhlField[] };
  return json.customFields ?? [];
}

async function createField(
  apiKey: string,
  locationId: string,
  name: string,
  dataType: string,
): Promise<GhlField> {
  const res = await fetch(`${baseUrl()}/locations/${locationId}/customFields`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({ name, dataType, model: 'contact' }),
  });
  if (!res.ok) {
    throw new Error(`create "${name}" failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { customField?: GhlField } & GhlField;
  return json.customField ?? json;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const envFileArg = argv.find((a) => a.startsWith('--env-file='));
  if (envFileArg) {
    const path = envFileArg.slice('--env-file='.length);
    if (!existsSync(path)) {
      console.error(`env-file not found: ${path}`);
      process.exit(1);
    }
    process.loadEnvFile(path);
  }

  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) {
    console.error('GHL_API_KEY and GHL_LOCATION_ID must be set (use --env-file).');
    process.exit(1);
  }

  console.log(`\nHighLevel setup${dryRun ? ' (DRY RUN)' : ''} — location ${locationId}\n`);

  const existing = await listFields(apiKey, locationId);
  const byKey = new Map(existing.map((f) => [f.fieldKey, f]));

  let created = 0;
  for (const want of DESIRED_FIELDS) {
    const have = byKey.get(want.key);
    if (have) {
      console.log(`  ok      ${want.key}  (id ${have.id})`);
      continue;
    }
    if (dryRun) {
      console.log(`  missing ${want.key}  (would create "${want.name}")`);
      created++;
      continue;
    }
    const field = await createField(apiKey, locationId, want.name, want.dataType);
    if (field.fieldKey !== want.key) {
      console.warn(
        `  WARN    created "${want.name}" but GHL derived key ${field.fieldKey}, ` +
          `expected ${want.key} — update the client key map.`,
      );
    } else {
      console.log(`  created ${field.fieldKey}  (id ${field.id})`);
    }
    created++;
  }

  console.log(
    `\nDone — ${existing.length} existing field(s), ` +
      `${dryRun ? created + ' would be created' : created + ' created'}.\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
