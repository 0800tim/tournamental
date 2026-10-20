# DSAR runbook: access and erasure requests

> Operator steps for a data subject access request and an erasure request, written 2026-10-17 from the schemas on `main` (e1e0eac9) and the register-interest review in PR #336. Read-only against production: every command below that changes data is for Tim to run, in order, after the checks. The privacy policy (tournamental.com/legal/privacy) promises a 30-day SLA for erasure and access "on request"; `docs/32-auth-and-privacy.md` has the data map this runbook executes.

## 0. Before anything: identify the person and verify the request

A request arrives at info@tournamental.com (the only mailbox the policy names). Do not act on a request made on someone's behalf, or from an address or number that is not on the account, until they have confirmed from one that is.

Identifiers we key on, in order of strength:

| Identifier | Where it comes from | Note |
| --- | --- | --- |
| Phone, E.164 (`+64...`) | `user.phone` in auth.db | strongest: they can prove it by signing in |
| Email, lower-cased and trimmed | `user.email` in auth.db, `register_interest.email`, `syndicates.owner_email` | the register-interest form stores it lower-cased |
| Auth user id (`u_...`) | `user.id` in auth.db; the same id is `users.id` and every `user_id` in game.db | legacy Supabase-era ids are UUIDs without the prefix |
| Display name or handle | `user.display_name`, `syndicate_owners_membership.handle` and `display_name` | not unique; confirm with another identifier |
| Telegram id | `user.telegram_id`, bot `tg_user.chat_id` | |

Verification that costs nothing: ask them to reply from the email on file, or to sign in once (an OTP to the phone on file) and quote their display name. Record the request date, the identifiers, and the verification used in the private DSAR log at `docs/internal/privacy/dsar-log.md` (gitignored `docs/internal/`, create it on first use). Nothing about a request goes into git.

## 1. Where a person's data lives

All three SQLite files are on the box and the units read them live. `sqlite3` is installed (`/usr/bin/sqlite3`). Open the live files read-only for lookups; write only inside the transactions in section 3.

| Store | Path | Tables or files holding personal data |
| --- | --- | --- |
| auth.db (auth-sms) | `apps/auth-sms/data/auth.db` | `user` (phone, email, names, display name, country, city, favourite team, telegram id and username, HighLevel contact id); `session` (user id, user agent, IP); `phone_otp` and `email_otp` (transient, keyed by phone or email, minutes); `rate_limit` (keys contain phone or IP, hours) |
| OTP audit log | `apps/auth-sms/data/audit/otp.log.jsonl` | one JSON line per send and verify with a truncated SHA-256 `phoneId` and the IP; never the raw phone |
| game.db (game service, web app) | `apps/game/data/game.db` | `users` (id only); `brackets` (user id, picks, `share_guid`); `syndicate_members`; `syndicate_owners_membership` (user id, handle, display name, `status` which also holds pending and denied **join requests**); `syndicates` (owner email, phone, handle, user id, `share_guid`); `syndicates_pending_ghl`; `verified_pundit_records`; `user_api_keys`; `bracket_import_audit`; `invite_jobs` (`created_by`) and `invite_recipients` (other people's emails and phones the person uploaded, or the person as someone else's recipient); `bot_owner`, `api_key`, `federated_node` (owner email); `register_interest` (email, first name, country, phone, salted IP hash, user agent, invite code, referrer code, HighLevel contact id) |
| Bot store (tournament-bot) | the SQLite file configured in `apps/tournament-bot/src/storage.ts` | `tg_user` (chat id, user id, country, language, notification settings); `syndicate_member` |
| Admin audit | `apps/admin/.admin-audit.jsonl` | append-only lines: admin actor email, action, target id, before and after snapshots of the record changed |
| HighLevel (CRM, off box) | Tim's HighLevel location | one contact per person: phone, email, names, country, tags (`player`, `register_interest`, `rwc2027_interest`, pool tags), custom fields (invite code and URL, referrer, consent). Contact ids are stored in `user.highlevel_contact_id` and `register_interest.ghl_contact_id` |
| Service logs | journald, user units `tournamental-*` | request logs with user ids and hashed phones; the policy says 30 days (see open items) |
| game.db snapshots | `backups/game-db/` (repo root, gitignored) | pre-kickoff `.bak` files from the cron script; none on disk today |

What is **not** ours to delete and must be named in the reply: Cloudflare edge logs (Cloudflare's retention), Google Tag Manager and GA4 (consent-gated, pseudonymous client ids; the person can clear cookies), WhatsApp and Telegram message history on their own device and the platform.

Foreign keys: the game service, auth-sms and the web app's stores all open SQLite with `PRAGMA foreign_keys = ON`, but the `sqlite3` CLI does not, so every transaction below sets it first. The cascades that exist: `brackets`, `syndicate_members`, `verified_pundit_records` and `bot_owner` cascade from `users`; `invite_recipients` cascades from `invite_jobs`; `federated_leaderboard_snapshot` cascades from `federated_node`. Nothing else cascades, which is why the membership, syndicate, api key, import audit and register-interest rows are deleted by hand.

## 2. Access request

Goal: one JSON file with everything we hold about the person, minus other people's data, sent from info@tournamental.com within 30 days.

1. Find the ids. Read-only, on the live file:

```bash
cd /srv/projects/internal/tournamental
P='+64211234567'; E='person@example.com'
sqlite3 -readonly -json apps/auth-sms/data/auth.db \
  "SELECT id, phone, email, display_name, first_name, last_name, country, city, favourite_team_code, telegram_id, telegram_username, highlevel_contact_id, created_at, last_seen_at FROM user WHERE phone = '$P' OR lower(email) = lower('$E');"
```

Note every `id` returned (there can be more than one if they signed in by phone and separately by email; say so in the reply).

2. Export, per id (`U`), into one folder under `docs/internal/privacy/dsar/<date>-<id>/` (gitignored):

```bash
U='u_xxxxxxxx'; OUT="docs/internal/privacy/dsar/$(date +%F)-$U"; mkdir -p "$OUT"
A=apps/auth-sms/data/auth.db; G=apps/game/data/game.db
sqlite3 -readonly -json $A "SELECT * FROM user WHERE id='$U';" > "$OUT/auth-user.json"
sqlite3 -readonly -json $A "SELECT id, created_at, expires_at, user_agent, ip FROM session WHERE user_id='$U';" > "$OUT/auth-sessions.json"
sqlite3 -readonly -json $G "SELECT * FROM brackets WHERE user_id='$U';" > "$OUT/brackets.json"
sqlite3 -readonly -json $G "SELECT syndicate_id, role, joined_at, handle, display_name, status FROM syndicate_owners_membership WHERE user_id='$U';" > "$OUT/pool-memberships.json"
sqlite3 -readonly -json $G "SELECT * FROM syndicate_members WHERE user_id='$U';" > "$OUT/pool-members-legacy.json"
sqlite3 -readonly -json $G "SELECT id, slug, name, owner_email, owner_phone, owner_handle, share_guid, created_at FROM syndicates WHERE owner_user_id='$U' OR lower(owner_email)=lower('$E') OR owner_phone='$P';" > "$OUT/pools-owned.json"
sqlite3 -readonly -json $G "SELECT * FROM verified_pundit_records WHERE user_id='$U';" > "$OUT/pundit.json"
sqlite3 -readonly -json $G "SELECT id, label, created_at, last_used_at, revoked_at FROM user_api_keys WHERE user_id='$U';" > "$OUT/api-keys.json"
sqlite3 -readonly -json $G "SELECT * FROM bracket_import_audit WHERE user_id='$U';" > "$OUT/imports.json"
sqlite3 -readonly -json $G "SELECT id, syndicate_id, status, created_at FROM invite_jobs WHERE created_by='$U';" > "$OUT/invite-jobs.json"
sqlite3 -readonly -json $G "SELECT job_id, email, phone_e164, created_at FROM invite_recipients WHERE lower(email)=lower('$E') OR phone_e164='$P';" > "$OUT/invited-by-others.json"
sqlite3 -readonly -json $G "SELECT id, tournament_id, email, first_name, country, phone, consent, source_host, source_path, referred_by_code, invite_code, ghl_status, ghl_contact_id, created_at, updated_at FROM register_interest WHERE lower(email)=lower('$E');" > "$OUT/register-interest.json"
sqlite3 -readonly -json $G "SELECT COUNT(*) AS referrals FROM register_interest WHERE referred_by_code IN (SELECT invite_code FROM register_interest WHERE lower(email)=lower('$E'));" > "$OUT/referral-count.json"
sqlite3 -readonly -json $G "SELECT bot_id, owner_email, created_at FROM bot_owner WHERE lower(owner_email)=lower('$E');" > "$OUT/bots.json"
```

   For the bot store, the same pattern on its file: `SELECT * FROM tg_user WHERE user_id='$U'`.

   The OTP audit log is keyed by a truncated hash, so the person's lines cannot be selected by phone without recomputing the hash the way `apps/auth-sms/src/audit.ts` does; include the explanation rather than the lines unless they ask. The admin audit log: `grep -n "$U" apps/admin/.admin-audit.jsonl` and include any matching lines with the admin actor's email removed.

3. Strip other people's data before sending: pool member lists are not theirs, `invite_recipients` rows they uploaded contain third parties (give counts, not rows), and the `before` and `after` snapshots in admin audit lines can contain other members.

4. HighLevel, by Tim in the HighLevel UI: open the contact (search by phone or email), export the contact record and its activity, and add it to the folder. No API calls.

5. Reply from info@tournamental.com with the folder zipped, a one-paragraph plain-language summary (what we hold, why, for how long), and the list of things not under our control from section 1. Log the completion date in the DSAR log.

## 3. Erasure request

The policy promises: the account is deleted; phone and email are replaced by a salted hash kept for 12 months for fraud prevention and then deleted; picks and brackets stay reachable under the share GUID but anonymised, unless the person asks for the full cascade, in which case the brackets go too. Decide which path before starting and write it in the DSAR log.

### 3.1 Prepare

1. Finish an access-style lookup (section 2, steps 1 and 2) so the ids, pool ownerships and HighLevel contact ids are known before anything is deleted. Keep that folder until the request is closed.
2. Take a consistent snapshot of both databases, for a 30-day rollback window only:

```bash
cd /srv/projects/internal/tournamental
S="docs/internal/privacy/dsar/$(date +%F)-$U/pre-erasure"; mkdir -p "$S"
sqlite3 apps/auth-sms/data/auth.db ".backup '$S/auth.db'"
sqlite3 apps/game/data/game.db ".backup '$S/game.db'"
```

   `.backup` is safe on the live WAL databases. Delete the snapshot folder after 30 days (put the date in the DSAR log).

3. Pools the person owns (`pools-owned.json`): the policy does not promise to keep other people's pools alive. Decide per pool: transfer ownership to an active member (update `syndicates.owner_user_id`, `owner_email`, `owner_phone`, `owner_handle` to the new owner's values, and their membership `role` to `owner`), or delete the pool and its memberships. Ask the person if the pool has other active members.

4. Compute the fraud-prevention hashes the policy keeps for 12 months, and put only the hashes and the date in the DSAR log (the raw identifiers leave the log once the deletion is done):

```bash
SALT="$(grep '^TOURNAMENTAL_INTERNAL_SECRET=' apps/web/.env.production | cut -d= -f2-)"
printf '%s:%s' "$SALT" "$P" | sha256sum | cut -c1-32
printf '%s:%s' "$SALT" "$(printf '%s' "$E" | tr 'A-Z' 'a-z')" | sha256sum | cut -c1-32
```

   This is the same salt and shape `apps/web/lib/register-interest/store.ts` uses for `ip_hash`, so one convention covers both. There is no table for these yet (see open items); the private log is the record.

### 3.2 auth.db

Stop nothing; the service holds the file in WAL mode and tolerates the transaction.

```bash
sqlite3 apps/auth-sms/data/auth.db <<SQL
PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM session    WHERE user_id = '$U';
DELETE FROM phone_otp  WHERE phone = '$P';
DELETE FROM email_otp  WHERE lower(email) = lower('$E');
DELETE FROM rate_limit WHERE key LIKE '%' || '$P' || '%' OR key LIKE '%' || lower('$E') || '%';
DELETE FROM user       WHERE id = '$U';
COMMIT;
SQL
```

If the person had two auth rows (phone and email signed in separately), run it once per id. Any open browser session dies at the next request because the JWT's user no longer exists.

### 3.3 game.db, default path (anonymise, keep brackets under the share GUID)

```bash
sqlite3 apps/game/data/game.db <<SQL
PRAGMA foreign_keys = ON;
BEGIN;
-- Names on pool memberships and join requests (pending or denied rows too).
UPDATE syndicate_owners_membership SET handle = NULL, display_name = NULL WHERE user_id = '$U';
-- Legacy membership table, no names, just the link.
DELETE FROM syndicate_members WHERE user_id = '$U';
-- Pool ownership was resolved in 3.1 step 3; this catches a missed one.
UPDATE syndicates SET owner_email = 'erased@tournamental.invalid', owner_phone = '', owner_handle = NULL WHERE owner_user_id = '$U';
DELETE FROM user_api_keys WHERE user_id = '$U';
DELETE FROM bracket_import_audit WHERE user_id = '$U';
DELETE FROM verified_pundit_records WHERE user_id = '$U';
-- Invites they sent (third-party recipients cascade with the job) and invites naming them.
DELETE FROM invite_jobs WHERE created_by = '$U';
DELETE FROM invite_recipients WHERE lower(email) = lower('$E') OR phone_e164 = '$P';
-- Bot Arena ownership, if any.
DELETE FROM federated_node WHERE lower(owner_email) = lower('$E');
DELETE FROM api_key WHERE lower(owner_email) = lower('$E');
DELETE FROM bot_owner WHERE lower(owner_email) = lower('$E');
COMMIT;
SQL
```

The `users` row (id and created date only) and the `brackets` rows stay: with the auth row gone the id links to nothing, which is the anonymised state the policy describes. The share link `/s/<share_guid>` keeps working and shows the picks without a name.

Register-interest, which is keyed by email and lives in the same file, uses the helper from PR #336 so the same code path serves the route and the runbook:

```bash
cd apps/web && node --input-type=module -e "
import { deleteRegisterInterest } from './lib/register-interest/store.ts';
console.log('rows removed:', deleteRegisterInterest('rwc-2027', '$E'));
" 
```

(Run through `tsx` if plain Node refuses the `.ts` import: `node_modules/.bin/tsx -e "..."`. Until PR #336 merges, the SQL is `DELETE FROM register_interest WHERE tournament_id = 'rwc-2027' AND email = lower('$E');`.) Other people's rows that carry the person's `invite_code` as `referred_by_code` keep that code: it is a random token, not an identifier, and the referral count the loop shows is now nobody's.

### 3.4 game.db, full cascade (the person asked for the brackets to go too)

Run 3.3 first, then:

```bash
sqlite3 apps/game/data/game.db <<SQL
PRAGMA foreign_keys = ON;
BEGIN;
DELETE FROM users WHERE id = '$U';   -- cascades: brackets, syndicate_members, verified_pundit_records, bot_owner
COMMIT;
SQL
```

Share links for those brackets then 404. Say so in the reply.

### 3.5 Bot store, admin audit, logs

- Bot store: `DELETE FROM syndicate_member WHERE user_id = '$U'; DELETE FROM tg_user WHERE user_id = '$U' OR chat_id = <telegram id>;` on the bot's SQLite file. The bot then treats the chat as new.
- `apps/admin/.admin-audit.jsonl` is append-only and is itself a security record. Do not delete lines. If a line's `before` or `after` snapshot contains the person's email or phone (`grep -c "$E" apps/admin/.admin-audit.jsonl`), replace those values in place with `[erased YYYY-MM-DD]` using a one-off script, keep the original line count, and note it in the DSAR log.
- OTP audit log: holds the hashed `phoneId` and the IP, which the policy covers under hashed device signals (90 days) and server logs (30 days). Nothing to do per person; see the open items for rotation.
- journald: `journalctl --user -u tournamental-auth-sms --since -30d | grep -c "$U"` to know whether the id appears; journald cannot delete single lines, retention does the work (open item).

### 3.6 HighLevel (Tim, manual, no API)

1. Open the contact by the ids in `auth-user.json` (`highlevel_contact_id`) and `register-interest.json` (`ghl_contact_id`), or by phone and email search.
2. Remove the contact from any active workflow, then delete the contact. HighLevel keeps its own audit of the deletion.
3. Check the `crm-bridge` and `syndicates_pending_ghl` queue in game.db has no pending row that would recreate the contact: `SELECT id, syndicate_id FROM syndicates_pending_ghl WHERE payload_json LIKE '%' || lower('$E') || '%';` (the queue stores the pool payload as JSON, owner email inside it) and delete it if present.

### 3.7 Verify, reply, close

```bash
for q in \
 "SELECT COUNT(*) FROM user WHERE id='$U' OR phone='$P' OR lower(email)=lower('$E')" \
 "SELECT COUNT(*) FROM session WHERE user_id='$U'"; do sqlite3 -readonly apps/auth-sms/data/auth.db "$q"; done
for q in \
 "SELECT COUNT(*) FROM syndicate_owners_membership WHERE user_id='$U' AND (handle IS NOT NULL OR display_name IS NOT NULL)" \
 "SELECT COUNT(*) FROM syndicates WHERE lower(owner_email)=lower('$E') OR owner_phone='$P'" \
 "SELECT COUNT(*) FROM register_interest WHERE lower(email)=lower('$E')" \
 "SELECT COUNT(*) FROM invite_recipients WHERE lower(email)=lower('$E') OR phone_e164='$P'" \
 "SELECT COUNT(*) FROM user_api_keys WHERE user_id='$U'"; do sqlite3 -readonly apps/game/data/game.db "$q"; done
```

Every count is 0 (and `SELECT COUNT(*) FROM brackets WHERE user_id='$U'` is 0 only on the full-cascade path). Reply from info@tournamental.com: what was deleted, what was anonymised and why the share link still works (or no longer does), the 12-month hash retention, and the third-party systems from section 1. Record the completion date and the snapshot deletion date in the DSAR log. Delete the pre-erasure snapshot after 30 days.

## 4. Open items for Tim (found while writing this)

1. **No store for the 12-month fraud hashes** the policy promises. Today they live only in the private DSAR log. A small `erased_identifiers(hash, erased_at)` table in auth.db, checked on sign-up, would make the promise real.
2. **No self-service deletion.** Everything above is operator SQL. A `DELETE /v1/auth/me` in auth-sms that runs 3.2 and 3.3 would remove most of this runbook.
3. **OTP audit log is not rotated**: `apps/auth-sms/data/audit/otp.log.jsonl` runs from August with no logrotate entry, against a 30-day log promise.
4. **journald retention is not pinned** (502 MB of journals, no `MaxRetentionSec` in `/etc/systemd/journald.conf`), against the same 30-day promise. Root change.
5. **Admin Customer 360** shows full phone and email with no audit of the view (docs/33 item); an access or erasure request handled through the console should leave a trace.
6. **Backups**: `backups/game-db/` is empty today, but if the pre-kickoff cron returns for RWC 2027, erased people reappear in snapshots; the retention of those `.bak` files needs a number.
7. **Register-interest rows have no retention period** (RI-10): decide when unconverted sign-ups are purged after the tournament.
