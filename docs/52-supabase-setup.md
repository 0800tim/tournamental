# 52, Supabase Setup (Auth + Identity)

> **Tim's hands-on setup walkthrough for the Supabase project that backs
> Tournamental's user identity, friend graph, and invite codes.**
>
> Companion to [`docs/26-setup-checklist.md`](26-setup-checklist.md). When
> that doc says "configure Supabase", come here.
>
> **Goal**: 30-minute setup that takes you from "fresh Supabase account"
> to "play.tournamental.com signups working end-to-end".

## What you'll have at the end

- A Supabase project hosting Tournamental's user identity tables.
- Email magic-link sign-in working in production.
- WhatsApp OTP sign-in routed through Aiva SMS.
- The Telegram Login Widget verifying server-side (full session-mint
  shipping in a v1.1 follow-up).
- Three env vars set in `apps/web/.env.production`:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Two server secrets in the same `.env`:
  - `SUPABASE_PHONE_HASH_SALT`
  - `SUPABASE_SMS_HOOK_SECRET`

---

## Step 1, Create the Supabase project

1. Go to <https://supabase.com/dashboard> and sign in (the
   Tournamental Holdings GitHub identity is fine for v1; we can move
   ownership later).
2. Click **New project**.
3. **Organisation**: Tournamental (create if missing).
4. **Project name**: `tournamental`.
5. **Database password**: generate a 32-char password via
   `openssl rand -base64 32`. Paste it into the Bitwarden vault as
   "Supabase / tournamental / db-password". You won't need this day-to-day
  , Supabase handles connection pooling, but you need it for the CLI
   `supabase db push` step.
6. **Region**: **Sydney (ap-southeast-2)**. Closest to the NZ-hosted dev
   box and to the EU/UK/AU user base.
7. **Pricing plan**: Free for v1. We'll upgrade to Pro once we cross
   500 active users (free tier caps at 500 MAU on auth).
8. Click **Create new project** and wait ~2 minutes for provisioning.

---

## Step 2, Paste env vars

When the project is ready, go to **Project Settings → API**.

You'll see three values; map them to your `.env.production`:

| Supabase field          | Env var                          | Visibility |
|-------------------------|----------------------------------|-----------|
| Project URL             | `NEXT_PUBLIC_SUPABASE_URL`       | public    |
| `anon` `public` key     | `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | public    |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY`      | **server only** |

Scroll down on the same page to **JWT Settings** and copy the **JWT
Secret** into `SUPABASE_JWT_SECRET`. The game service uses it to verify
Bearer tokens on `/v1/picks/*` writes.

Then generate two more secrets and add them to `.env.production`:

```bash
# Phone-hash salt for friend matching (32 hex chars)
openssl rand -hex 32   # → paste into SUPABASE_PHONE_HASH_SALT

# SMS-hook signing secret (32 hex chars)
openssl rand -hex 32   # → paste into SUPABASE_SMS_HOOK_SECRET
```

You'll paste the SMS-hook secret into the Supabase dashboard at Step 4
too, it has to match on both sides.

Restart the web service:

```bash
pm2 restart vtorn-web-prod
```

---

## Step 3, Run the migration

The migration creates `user_profiles`, `user_profile_history`,
`friendships`, `invite_codes`, RLS policies, and the auto-provision
trigger that mirrors `auth.users` into `user_profiles`.

### Option A, Supabase Dashboard (quickest)

1. Go to **SQL Editor → New Query**.
2. Copy the contents of
   `supabase/migrations/0001_user_identity.sql` from this repo.
3. Paste into the editor, click **Run**.
4. You should see "Success. No rows returned", the tables are created.
5. Go to **Database → Tables**: you should see `user_profiles`,
   `friendships`, `invite_codes`, `user_profile_history`.

### Option B, Supabase CLI (preferred for repeatable deploys)

```bash
# One-off, install the CLI on your dev box if not present:
brew install supabase/tap/supabase   # macOS
# or: npm i -g supabase

cd /path/to/vtorn                    # the repo root
supabase login                       # opens browser, paste access token
supabase link --project-ref <ref>    # ref is the last segment of the project URL
supabase db push                     # runs all migrations under supabase/migrations/
```

The `db push` is idempotent, re-runs apply only new migrations.

### Verify

In the SQL editor, run:

```sql
SELECT count(*) FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('user_profiles','friendships','invite_codes','user_profile_history');
-- expect 4

SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
-- expect at least 8 (RLS policies on the 4 tables)
```

---

## Step 4, Configure auth providers

### Step 4a, Email magic-link

1. Go to **Authentication → Providers → Email**.
2. Set **Enable Email provider**: ON.
3. **Confirm email**: OFF for v1 (magic-link is its own confirmation).
4. **Secure email change**: ON.
5. **Site URL**: `https://play.tournamental.com`
6. **Redirect URLs**: add
   - `https://play.tournamental.com/auth/callback`
   - `http://localhost:3300/auth/callback` (for dev)
7. Save.

For v1, Supabase's default SMTP is fine (low volume, free tier). For
production-scale we'll swap to Resend in a follow-up PR. See **Step 5**
below.

### Step 4b, Telegram Login Widget

The widget runs client-side; the server verifies the HMAC. The verifier
lives at `apps/web/app/api/auth/telegram-callback/route.ts`.

1. Confirm `TELEGRAM_BOT_TOKEN` is set in `apps/web/.env.production`.
   (You set this when configuring the tournament-bot per
   [docs/26 §1.1](26-setup-checklist.md).)
2. Set `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=TournamentalBot` in the same env.
3. Open <https://t.me/BotFather>:
   - `/mybots` → choose `@TournamentalBot`
   - **Bot Settings → Domain → /setdomain** → enter
     `play.tournamental.com`
   - This is required for the widget to mount on our domain.
4. Restart `pm2 restart vtorn-web-prod`.
5. Smoke test: open the SignupModal in production, switch to Telegram
   tab, click the widget. The browser console should log a 200 from
   `/api/auth/telegram-callback`.

**v1 caveat**: clicking the widget verifies your identity but does not
yet mint a Supabase session, full session-mint is the v1.1 sprint goal
(see `IDEAS.md`). Users who click Telegram are funneled into the
phone-OTP path; their telegram_id is then bound on the resulting profile.

### Step 4c, WhatsApp OTP via Aiva SMS hook

1. Go to **Authentication → Providers → Phone**.
2. Set **Enable Phone provider**: ON.
3. **SMS Provider**: choose **Custom**.
4. **SMS sender callback URL**:
   `https://play.tournamental.com/api/auth/sms-hook`
5. **Signing secret**: paste the same value you put in
   `SUPABASE_SMS_HOOK_SECRET` (Step 2 above).
6. **Message template** (used by Supabase for the OTP body):
   `Your Tournamental verification code is {{ .Code }}. It expires in
   10 minutes.`
7. **Confirm phone change**: ON.
8. **OTP expiry**: 600 seconds (10 min).
9. Save.

The hook endpoint forwards OTPs to the configured SMS gateway, make sure
`AIVA_SMS_API_URL`, `AIVA_SMS_API_KEY`, and `AIVA_WA_SESSION_ID` are set in
`apps/web/.env.production`. See [`packages/aiva-client/`](../packages/aiva-client/)
for the default Aiva SMS gateway client.

### Deferred, Google / Apple / X (week 2-3)

These follow-up providers ship in a separate PR. Leave them disabled
for now.

---

## Step 5, SMTP (optional for v1)

Supabase's default SMTP works out of the box but has a low rate limit
(3 emails per hour, shared across all free-tier projects in your region).
Fine for the launch week; before public marketing campaigns we move to
a dedicated SMTP.

**Recommended**: Resend.

1. <https://resend.com> → sign up with the Tournamental Holdings email.
2. **Domains → Add Domain** → `tournamental.com`.
3. Add the DNS records Resend gives you (SPF, DKIM, DMARC) via the
   Cloudflare dashboard for the `tournamental.com` zone. Wait ~10 min
   for verification.
4. **API Keys → Create API Key** → name "supabase-tournamental".
5. Back in Supabase: **Project Settings → Auth → SMTP Settings**:
   - **Host**: `smtp.resend.com`
   - **Port**: `465` (SSL) or `587` (TLS)
   - **Username**: `resend`
   - **Password**: the API key from step 4
   - **Sender email**: `noreply@tournamental.com`
   - **Sender name**: `Tournamental`
6. Save.

---

## Step 6, Smoke test the full flow

### Email magic-link

1. Open <https://play.tournamental.com>.
2. Hit the sign-in button (top-right avatar → sign in).
3. Email tab → enter your real email → "Send magic link".
4. Check inbox; click the link.
5. You should land back on `/world-cup-2026` with your handle visible
   top-right.
6. In the Supabase dashboard, **Authentication → Users**: you should
   see a new user row.
7. **Table Editor → user_profiles**: the trigger should have inserted a
   matching row with the `handle` derived from your email local-part.

### WhatsApp OTP

1. Sign out (avatar → sign out).
2. Open the SignupModal → WhatsApp tab.
3. Enter your WhatsApp number in E.164 format (e.g. `+6421...`).
4. You should receive a WhatsApp message: "Your Tournamental
   verification code is 123456..."
5. Paste the code → you're signed in.
6. In **Authentication → Users**, the same user now has a `phone`
   value attached.

### Telegram (verify-only for v1)

1. Sign out, SignupModal → Telegram tab.
2. Click the widget; complete the Telegram challenge in the popup.
3. Browser console should show a successful POST to
   `/api/auth/telegram-callback` with `{ verified: true, existing_user: false }`.
4. Confirm the route stored your `telegram_id` on the existing profile
   (if you also signed in via Email above): SQL editor →
   `SELECT id, handle, telegram_id FROM user_profiles WHERE telegram_id IS NOT NULL;`

### Pick saves end-to-end

1. While signed in, make a few group-stage picks.
2. Refresh on a different browser, sign in with the same email.
3. Picks should reappear (the bracket payload lives in the game-service
   SQLite, keyed by your Supabase user_id which the JWT carries).

---

## Step 7, Friend discovery smoke tests

### WhatsApp invite

1. Sign in. Open the bracket share card; the deep-link URL should look
   like `https://play.tournamental.com/i/k7m9q3`.
2. Sign out. Paste the URL into a fresh incognito window, should
   redirect to `/world-cup-2026?invited=1` and set a
   `vtorn_pending_invite` cookie.
3. Sign in with a *different* email. Run a SQL query to verify the
   friendship: `SELECT * FROM friendships WHERE source = 'whatsapp_invite';`

### Phone match

1. Sign in. In `/profile`, toggle **Find friends via my phone contacts**.
2. Run a curl test via the browser console (DevTools → Network: copy
   the session cookie):
   ```js
   const salt = (await fetch("/api/auth/phone-salt").then(r => r.json())).salt;
   const phones = ["+6421000001","+6421000002"];
   const enc = new TextEncoder();
   async function h(p) {
     const bytes = await crypto.subtle.digest(
       "SHA-256",
       new Uint8Array([...enc.encode(salt), 0, ...enc.encode(p)]),
     );
     return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2,"0")).join("");
   }
   const hashes = await Promise.all(phones.map(h));
   await fetch("/api/friends/discover/phone-match",
     { method: "POST", headers: {"content-type":"application/json"},
       body: JSON.stringify({ hashes }) }).then(r => r.json());
   ```
3. Response: empty `matched` array (no other users have those numbers
   yet, that's fine; just verifies the endpoint round-trip).

### Telegram contacts

This path runs inside the tournament-bot, not the browser. After the
bot is running:

```bash
curl -X POST https://play.tournamental.com/api/friends/discover/telegram \
  -H "X-Tournamental-Internal: $TOURNAMENTAL_INTERNAL_SECRET" \
  -H "content-type: application/json" \
  -d '{"user_id":"<uuid>","telegram_ids":[12345678,87654321]}'
```

---

## Step 8, Lock down

Before the launch week:

1. **Authentication → URL Configuration**: lock the redirect URL list
   to just the production host (remove the localhost entry).
2. **Project Settings → API → JWT Settings**: rotate the JWT secret if
   it was ever in a shared screenshare. Update `SUPABASE_JWT_SECRET` in
   `.env.production` and restart both `vtorn-web-prod` and
   `vtorn-game-prod` so the game service picks it up.
3. **Authentication → Email Templates**: edit the magic-link template
   to use the Tournamental brand. The default Supabase one is fine
   for soft-launch but mentions Supabase by name.
4. **Database → Replication**: leave OFF (free tier doesn't support it
   anyway).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Magic-link email never arrives | Default SMTP rate limit (3/h) | Move to Resend per Step 5 |
| "redirect_to is not allowed" | Not in the Auth → URL Configuration list | Add the URL, save |
| WhatsApp OTP doesn't send | Aiva SMS session disconnected | `curl POST /api/v1/whatsapp/sessions/<id>/start` |
| `/api/auth/sms-hook` returns 401 | `SUPABASE_SMS_HOOK_SECRET` mismatch | Re-paste in both Supabase dashboard + .env |
| Profile row missing after sign-up | Trigger didn't fire | Re-run `0001_user_identity.sql`, `handle_new_auth_user` is idempotent |
| Telegram widget says "Bot domain invalid" | Forgot BotFather `/setdomain` | Set it to `play.tournamental.com` |
| Game service returns 401 on `/v1/picks/*` | JWT secret not set | Ensure `SUPABASE_JWT_SECRET` is in `apps/game/.env.production`; restart `vtorn-game-prod` |

---

## What this doc explicitly defers

- **Google OAuth, Apple Sign-in, X (Twitter) OAuth**, week 2-3 follow-up PR.
- **Native Telegram OIDC session-mint**, see `IDEAS.md` "Telegram custom OAuth provider".
- **Apple privacy nutrition labels** for native app stores, handled in `docs/26` Phase 5.
- **Supabase Vault for secrets**, for v1 we store the phone-hash salt
  in `.env`; production hardening moves it to Vault.

---

## Cross-references

- [`docs/26-setup-checklist.md`](26-setup-checklist.md), Tim's full
  external-account checklist (Phase 1 row 1.6 points back here).
- [`docs/32-auth-and-privacy.md`](32-auth-and-privacy.md), privacy
  posture (now reflects Supabase as the production trust model).
- [`docs/13-telegram-bot-and-auth.md`](13-telegram-bot-and-auth.md) -
  Telegram bot identity layer.
- [`packages/aiva-client/`](../packages/aiva-client/), the default
  SMS / WhatsApp gateway client used by the OTP hook.
- `supabase/migrations/0001_user_identity.sql`, the schema this doc
  walks you through running.
